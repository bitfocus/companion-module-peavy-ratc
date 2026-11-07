import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import {
	GetConfigFields,
	loginPassword,
	loginUsername,
	ratcVersion,
	validPort,
	type ModuleConfig,
	type ModuleSecrets,
} from './config.js'
import { UpgradeScripts } from './upgrades.js'
import { ActionId, UpdateActions, type ActionSchema } from './actions.js'
import {
	aliasNameValues,
	aliasVariableIds,
	isRawAlias,
	UpdateVariableDefinitions,
	type VariablesSchema,
} from './variables.js'
import { RatcConnection, type ConnectionTiming, type SessionReply } from './connection.js'
import { cmd, type RatcVersion } from './consts.js'
import { changeGroupGet, controlGet, onLoginCommands } from './protocol.js'
import { errorMessage, unhandledOption } from './utils.js'

export type ModuleTypes = {
	config: ModuleConfig
	secrets: ModuleSecrets
	actions: ActionSchema
	feedbacks: Record<string, never>
	variables: VariablesSchema
}

export { UpgradeScripts }

/**
 * How long after the last alias the DSP lists to wait before updating the actions and variables. Defining them again for
 * every alias, as the module did, made a long list slow to take in.
 */
export const ALIAS_LIST_SETTLE = 500

type ValueReply = Extract<SessionReply, { type: 'value' }>

export default class PeavyRatcInstance extends InstanceBase<ModuleTypes> {
	config!: ModuleConfig // Setup in init()
	/** Overrides the connection's timing. Tests shorten it */
	timing: Partial<ConnectionTiming> | undefined
	/** Tests shorten it */
	aliasListSettle = ALIAS_LIST_SETTLE
	#connection: RatcConnection | undefined
	/** The aliases offered in the actions, and with variables defined */
	#aliases: readonly string[] = []
	/** The aliases listed since logging in, which replace {@link #aliases} once the list settles */
	readonly #listed = new Set<string>()
	#listTimer: NodeJS.Timeout | undefined
	#recording = false
	#lastStatus: { status: InstanceStatus; message: string | null } | undefined

	constructor(internal: unknown) {
		super(internal)
		// RATCv2 RAW mode aliases have no variables defined, but their values are set
		this.instanceOptions.disableVariableValidation = true
	}

	get version(): RatcVersion {
		return ratcVersion(this.config)
	}

	/** The control aliases the DSP listed, in its order */
	get controlAliases(): readonly string[] {
		return this.#aliases
	}

	async init(config: ModuleConfig, _isFirstInit: boolean, secrets: ModuleSecrets | undefined): Promise<void> {
		await this.configUpdated(config, secrets)
	}

	async configUpdated(config: ModuleConfig, secrets: ModuleSecrets | undefined): Promise<void> {
		this.config = config
		this.#close()
		this.#aliases = []
		this.#listed.clear()
		UpdateActions(this)
		UpdateVariableDefinitions(this)
		this.#open(loginUsername(config), loginPassword(secrets))
	}

	// When module gets deleted
	async destroy(): Promise<void> {
		this.log('debug', `destroy. ID: ${this.id}`)
		this.#close()
		this.#status(InstanceStatus.Disconnected, null)
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	// Track whether actions are being recorded
	handleStartStopRecordActions(isRecording: boolean): void {
		this.#recording = isRecording
	}

	/**
	 * Queues a command for the DSP
	 * @param signal an action's context.signal, so a command the user no longer wants is dropped before it is sent
	 * @throws if not logged in, or the command is not sent
	 */
	async sendCommand(command: string, signal?: AbortSignal): Promise<void> {
		if (this.#connection === undefined) throw new Error('Not connected to DSP')
		await this.#connection.send(command, signal)
	}

	/** Queues commands the module sends of its own accord, logging rather than throwing if they can't be */
	queueCommands(...commands: string[]): void {
		for (const command of commands) {
			this.sendCommand(command).catch((err) => this.log('debug', `${command} not sent: ${errorMessage(err)}`))
		}
	}

	#open(username: string, password: string): void {
		const configHost: unknown = this.config.host
		const host = typeof configHost === 'string' ? configHost.trim() : ''
		const port = validPort(this.config.port)
		if (host === '') {
			this.#status(InstanceStatus.BadConfig, 'No host')
			return
		}
		if (port === undefined) {
			this.#status(InstanceStatus.BadConfig, `Invalid port ${String(this.config.port)}`)
			return
		}
		const version = this.version
		const connection = new RatcConnection({
			host,
			port,
			version,
			username,
			password,
			log: (level, message) => this.log(level, message),
			keepAliveCommand: () => changeGroupGet(version),
			timing: this.timing,
		})
		connection.on('status', (status, message) => this.#status(status, message))
		connection.on('ready', () => this.#onReady())
		connection.on('reply', (reply) => this.#onReply(reply))
		this.#connection = connection
		connection.connect()
	}

	#close(): void {
		this.#connection?.destroy()
		this.#connection = undefined
		clearTimeout(this.#listTimer)
		this.#listTimer = undefined
	}

	#status(status: InstanceStatus, message: string | null): void {
		if (this.#lastStatus?.status === status && this.#lastStatus.message === message) return
		this.#lastStatus = { status, message }
		this.updateStatus(status, message)
	}

	#onReady(): void {
		// The list is asked for again, and replaces the one from the last session once it settles
		this.#listed.clear()
		clearTimeout(this.#listTimer)
		this.#listTimer = undefined
		this.queueCommands(...onLoginCommands(this.version))
		// Each action using a control queries it and adds it to the change group again, for this session
		this.subscribeActions()
	}

	#onReply(reply: SessionReply): void {
		switch (reply.type) {
			case 'alias':
				this.#onAlias(reply.alias)
				break
			case 'value':
				this.#onValue(reply)
				break
			case 'quietModeEnabled':
				this.log('warn', `${reply.text} - Quiet Mode Should be disabled for correct operation of this module`)
				this.#status(InstanceStatus.UnknownWarning, 'Quiet Mode Enabled')
				this.queueCommands(cmd.v2.quietModeDisable)
				break
			case 'quietModeDisabled':
				this.log('info', `Quiet Mode Disabled: ${reply.text}`)
				this.#status(InstanceStatus.Ok, 'Logged in')
				break
			case 'overflow':
				this.log('error', reply.text)
				this.#status(InstanceStatus.UnknownError, 'Overflow')
				break
			case 'notRunning':
				this.log('error', reply.text)
				this.#status(InstanceStatus.UnknownError, 'Project not running')
				break
			case 'log':
				this.log(reply.level, reply.text)
				break
			case 'unknown':
				this.log('warn', `Unexpected response received: ${reply.text}`)
				break
			default:
				unhandledOption(reply, undefined)
		}
	}

	#onAlias(alias: string): void {
		this.log('debug', `Control alias listed: ${alias}`)
		if (this.#listed.has(alias)) return
		this.#listed.add(alias)
		if (!isRawAlias(alias)) this.queueCommands(controlGet(this.version, alias))
		clearTimeout(this.#listTimer)
		this.#listTimer = setTimeout(() => this.#publishAliases(), this.aliasListSettle)
	}

	#publishAliases(): void {
		this.#listTimer = undefined
		this.#aliases = [...this.#listed]
		UpdateActions(this)
		UpdateVariableDefinitions(this)
		this.setVariableValues(aliasNameValues(this.#aliases))
	}

	#onValue(reply: ValueReply): void {
		this.log('debug', reply.text)
		if (this.#recording) this.#record(reply)
		const ids = aliasVariableIds(reply.alias)
		const values: VariablesSchema = { [ids.value]: reply.value }
		if (this.version === 'v2' && reply.position !== undefined) values[ids.position] = reply.position
		this.setVariableValues(values)
	}

	/** RATCv2 records the position, which every control has. RATCv1 has none, so records a value that is a number */
	#record({ alias, value, position }: ValueReply): void {
		try {
			if (this.version === 'v2') {
				if (position === undefined) return
				this.recordAction(
					{ actionId: ActionId.ControlPositionSet, options: { alias, value: position } },
					`${ActionId.ControlPositionSet} ${alias}`,
				)
			} else {
				const number = Number(value)
				if (value.trim() === '' || !Number.isFinite(number)) return
				this.recordAction(
					{ actionId: ActionId.ControlSet, options: { alias, value: number } },
					`${ActionId.ControlSet} ${alias}`,
				)
			}
		} catch (err) {
			// Recording can stop between the reply arriving and this
			this.log('debug', `Action not recorded: ${errorMessage(err)}`)
		}
	}
}
