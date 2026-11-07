import { setTimeout as sleep } from 'node:timers/promises'
import { InstanceStatus, type CompanionActionDefinitions } from '@companion-module/base'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PeavyRatcInstance from '../main.js'
import { ActionId, type ActionSchema } from '../actions.js'
import type { ModuleConfig, ModuleSecrets } from '../config.js'
import type { ConnectionTiming } from '../connection.js'
import { closedPort, FakeDsp } from './fakeDsp.js'
import { definition, runAction } from './fixtures.js'
import { createContext, type HostContext } from './hostContext.js'

const TIMING: ConnectionTiming = { messageInterval: 2, keepAliveInterval: 1000, reconnectInterval: 40 }
const SECRETS: ModuleSecrets = { password: 'password' }

let fake: FakeDsp
const instances: PeavyRatcInstance[] = []

beforeEach(async () => {
	fake = new FakeDsp()
	await fake.listen()
})

afterEach(async () => {
	for (const instance of instances.splice(0)) await instance.destroy()
	await fake.close()
})

function createInstance(timing: Partial<ConnectionTiming> = TIMING) {
	const context = createContext()
	const instance = new PeavyRatcInstance(context)
	instance.timing = timing
	instance.aliasListSettle = 20
	const log = vi.spyOn(instance, 'log').mockImplementation(() => {})
	instances.push(instance)
	return { instance, context, log }
}

function config(overrides: Partial<ModuleConfig> = {}): ModuleConfig {
	return { host: '127.0.0.1', port: fake.port, v2: true, username: 'defaultuser', ...overrides }
}

/** The action definitions last given to Companion */
const definedActions = (context: HostContext) =>
	context.setActionDefinitions.mock.calls.at(-1)?.[0] as CompanionActionDefinitions<ActionSchema>

/** The aliases the actions last offered */
function offeredAliases(context: HostContext): unknown[] {
	const alias = definition(definedActions(context), ActionId.ControlGet).options.find((o) => o.id === 'alias')
	return alias?.type === 'dropdown' ? alias.choices.map((c) => c.id) : []
}

/** The ids of the variables last defined */
const definedVariables = (context: HostContext): string[] =>
	Object.keys((context.setVariableDefinitions.mock.calls.at(-1)?.[0] ?? {}) as object)

/** The variable values last set, merged */
const variables = (context: HostContext): Record<string, unknown> =>
	Object.assign({}, ...context.setVariableValues.mock.calls.map(([values]) => values as object))

/** Waits for the login, and for the actions to offer the controls the DSP lists */
async function started(overrides: Partial<ModuleConfig> = {}, secrets: ModuleSecrets | undefined = SECRETS) {
	const created = createInstance()
	await created.instance.init(config(overrides), false, secrets)
	await vi.waitFor(() => expect(created.context.updateStatus).toHaveBeenCalledWith(InstanceStatus.Ok, 'Logged in'))
	await vi.waitFor(() => expect(offeredAliases(created.context)).toContain('Mute 1'))
	return created
}

describe('RATCv2', () => {
	it('logs in, then sets up the session and asks for the control list', async () => {
		const { context } = await started()
		const lines = fake.lines(1)
		expect(lines[0]).toBe('li defaultuser password')
		expect(lines.slice(1, 6)).toEqual(['sg', 'ka 30', 'qmd', 'cl', 'cgs 1'])
		expect(context.subscribeActions).toHaveBeenCalledOnce()
	})

	it('offers the listed aliases, and defines variables for all but RAW mode paths', async () => {
		fake.rawAliases = ['//devices/10/controls/hold_time']
		const { context } = await started()
		await vi.waitFor(() => expect(offeredAliases(context)).toContain('//devices/10/controls/hold_time'))
		expect(offeredAliases(context)).toEqual(['Gain 1', 'Mute 1', '//devices/10/controls/hold_time'])
		expect(definedVariables(context)).toEqual([
			'controlAliasName_Gain_1',
			'controlAliasValue_Gain_1',
			'controlAliasPosition_Gain_1',
			'controlAliasName_Mute_1',
			'controlAliasValue_Mute_1',
			'controlAliasPosition_Mute_1',
		])
		// Once for the config, and once for the whole list rather than once an alias
		expect(context.setVariableDefinitions).toHaveBeenCalledTimes(2)
		expect(context.setActionDefinitions).toHaveBeenCalledTimes(2)
		// Each listed control is queried, but not the RAW mode paths
		expect(fake.lines(1)).toEqual(expect.arrayContaining(['cg "Gain 1"', 'cg "Mute 1"']))
		expect(fake.lines(1).filter((line) => line.includes('//devices'))).toEqual([])
		await vi.waitFor(() =>
			expect(variables(context)).toMatchObject({
				controlAliasName_Gain_1: 'Gain 1',
				controlAliasValue_Gain_1: '-10.0dB',
				controlAliasPosition_Gain_1: 0.5,
				controlAliasValue_Mute_1: 'off',
				controlAliasPosition_Mute_1: 0,
			}),
		)
	})

	it('sets variables from the values the DSP reports, RAW mode paths included', async () => {
		const { context } = await started()
		fake.broadcast('valueIs "Gain 1" -6.0dB 0.750')
		fake.broadcast('valueIs "//devices/10/controls/hold_time" 20ms 0.2')
		await vi.waitFor(() =>
			expect(variables(context)).toMatchObject({
				controlAliasValue_Gain_1: '-6.0dB',
				controlAliasPosition_Gain_1: 0.75,
				controlAliasValue___devices_10_controls_hold_time: '20ms',
				controlAliasPosition___devices_10_controls_hold_time: 0.2,
			}),
		)
	})

	it('replaces the aliases on logging in again, rather than adding to them', async () => {
		const { context } = await started()
		fake.controls.delete('Mute 1')
		fake.controls.set('Gain 2', { value: '0.0dB', position: 0.8 })
		fake.dropConnections()
		await vi.waitFor(() => expect(offeredAliases(context)).toEqual(['Gain 1', 'Gain 2']))
		expect(fake.connections).toBe(2)
		expect(definedVariables(context)).not.toContain('controlAliasValue_Mute_1')
	})

	it('records a position set for each value the DSP reports while actions are recorded', async () => {
		const { instance, context } = await started()
		fake.broadcast('valueIs "Gain 1" -6.0dB 0.750')
		await vi.waitFor(() => expect(variables(context)).toMatchObject({ controlAliasPosition_Gain_1: 0.75 }))
		expect(context.recordAction).not.toHaveBeenCalled()
		instance.handleStartStopRecordActions(true)
		fake.broadcast('valueIs "Gain 1" -3.0dB 0.800')
		await vi.waitFor(() =>
			expect(context.recordAction).toHaveBeenCalledExactlyOnceWith(
				{ actionId: ActionId.ControlPositionSet, options: { alias: 'Gain 1', value: 0.8 } },
				'controlPositionSet Gain 1',
			),
		)
	})

	it('reports a wrong username or password, and sends nothing more', async () => {
		fake.alertErrors = true
		const { instance, context, log } = createInstance()
		await instance.init(config(), false, { password: 'wrong' })
		await vi.waitFor(() =>
			expect(context.updateStatus).toHaveBeenLastCalledWith(
				InstanceStatus.AuthenticationFailure,
				'Username / Password is incorrect',
			),
		)
		expect(log).toHaveBeenCalledWith('error', 'Username / Password is incorrect: loginFailed')
		await expect(instance.sendCommand('sg')).rejects.toThrow('Not logged in')
		await sleep(50)
		expect(fake.lines(1)).toEqual(['li defaultuser wrong'])
	})

	it('logs in again, once, when the DSP says it is not logged in', async () => {
		const { context } = await started()
		context.subscribeActions.mockClear()
		fake.answerLogins = false
		fake.broadcast('notLoggedIn')
		await vi.waitFor(() => expect(fake.lines(1).filter((l) => l.startsWith('li'))).toHaveLength(2))
		fake.broadcast('notLoggedIn')
		await vi.waitFor(() =>
			expect(context.updateStatus).toHaveBeenLastCalledWith(InstanceStatus.BadConfig, 'notLoggedIn'),
		)
		expect(fake.lines(1).filter((l) => l.startsWith('li'))).toHaveLength(2)
		fake.answerLogins = true
		fake.broadcast('loggedIn')
		await vi.waitFor(() => expect(context.subscribeActions).toHaveBeenCalledOnce())
	})

	it('reports a DSP in RATCv1 mode', async () => {
		fake.version = 'v1'
		const { instance, context } = createInstance()
		await instance.init(config(), false, SECRETS)
		await vi.waitFor(() =>
			expect(context.updateStatus).toHaveBeenLastCalledWith(InstanceStatus.BadConfig, 'Device in RATCv1 mode'),
		)
	})

	it('turns quiet mode off again if the DSP turns it on', async () => {
		const { context, log } = await started()
		const before = fake.lines(1).filter((l) => l === 'qmd').length
		fake.broadcast('quietModeEnabled')
		await vi.waitFor(() => expect(fake.lines(1).filter((l) => l === 'qmd')).toHaveLength(before + 1))
		expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('Quiet Mode Should be disabled'))
		await vi.waitFor(() => expect(context.updateStatus).toHaveBeenLastCalledWith(InstanceStatus.Ok, 'Logged in'))
	})

	it('polls the default change group as a keep alive', async () => {
		const created = createInstance({ ...TIMING, keepAliveInterval: 30 })
		await created.instance.init(config(), false, SECRETS)
		await vi.waitFor(() => expect(fake.lines(1).filter((l) => l === 'cgg').length).toBeGreaterThan(2))
	})

	it('logs what the DSP rejects or the module does not know', async () => {
		const { log } = await started()
		fake.broadcast('\x07unlistedControl "Gain 9"')
		fake.broadcast('something else')
		await vi.waitFor(() => expect(log).toHaveBeenCalledWith('warn', 'Unexpected response received: something else'))
		expect(log).toHaveBeenCalledWith('warn', 'unlistedControl "Gain 9"')
	})
})

describe('RATCv1', () => {
	beforeEach(() => {
		fake.version = 'v1'
	})

	it('logs in with the username and password a line each, then asks for the control list', async () => {
		const { context } = await started({ v2: false })
		expect(fake.lines(1).slice(0, 4)).toEqual(['defaultuser', 'password', 'statusGet', 'controlList'])
		expect(offeredAliases(context)).toEqual(['Gain 1', 'Mute 1'])
		// RATCv1 has no positions
		expect(definedVariables(context)).toEqual([
			'controlAliasName_Gain_1',
			'controlAliasValue_Gain_1',
			'controlAliasName_Mute_1',
			'controlAliasValue_Mute_1',
		])
		await vi.waitFor(() => expect(variables(context)).toMatchObject({ controlAliasValue_Gain_1: '-10.0dB' }))
	})

	it('sets a control', async () => {
		const { context } = await started({ v2: false })
		await runAction(definedActions(context), ActionId.ControlSet, { alias: 'Gain 1', value: -3 })
		await vi.waitFor(() => expect(variables(context)).toMatchObject({ controlAliasValue_Gain_1: '-3.000' }))
		expect(fake.lines(1)).toContain('controlSet "Gain 1" -3.000')
	})

	it('records a control set for each numeric value the DSP reports while actions are recorded', async () => {
		const { instance, context } = await started({ v2: false })
		instance.handleStartStopRecordActions(true)
		fake.broadcast('valueIs "Mute 1" on')
		fake.broadcast('valueIs "Gain 1" -4.5')
		await vi.waitFor(() =>
			expect(context.recordAction).toHaveBeenCalledExactlyOnceWith(
				{ actionId: ActionId.ControlSet, options: { alias: 'Gain 1', value: -4.5 } },
				'controlSet Gain 1',
			),
		)
	})

	it('reports a wrong password', async () => {
		const { instance, context } = createInstance()
		await instance.init(config({ v2: false }), false, { password: 'wrong' })
		await vi.waitFor(() =>
			expect(context.updateStatus).toHaveBeenLastCalledWith(
				InstanceStatus.AuthenticationFailure,
				'Username / Password is incorrect',
			),
		)
	})
})

describe('the connection', () => {
	it('reports a missing host or an unusable port as bad config, without connecting', async () => {
		const { instance, context } = createInstance()
		await instance.init(config({ host: '  ' }), false, SECRETS)
		expect(context.updateStatus).toHaveBeenLastCalledWith(InstanceStatus.BadConfig, 'No host')
		await instance.configUpdated(config({ port: '1632' as unknown as number }), SECRETS)
		expect(context.updateStatus).toHaveBeenLastCalledWith(InstanceStatus.BadConfig, 'Invalid port 1632')
		await sleep(50)
		expect(fake.connections).toBe(0)
		await expect(instance.sendCommand('sg')).rejects.toThrow('Not connected')
	})

	it('reports a DSP that cannot be reached', async () => {
		const { instance, context } = createInstance()
		await instance.init(config({ port: await closedPort() }), false, SECRETS)
		await vi.waitFor(() =>
			expect(context.updateStatus).toHaveBeenLastCalledWith(InstanceStatus.ConnectionFailure, expect.any(String)),
		)
	})

	it('connects with a changed config, offering that version actions and none of the last aliases', async () => {
		const { instance, context } = await started()
		const second = new FakeDsp()
		second.version = 'v1'
		second.controls.clear()
		second.controls.set('Level', { value: '1', position: 1 })
		await second.listen()
		try {
			await instance.configUpdated(config({ port: second.port, v2: false }), SECRETS)
			expect(definedActions(context)[ActionId.ControlSetInc]).toBeUndefined()
			expect(offeredAliases(context)).toEqual([])
			await vi.waitFor(() => expect(offeredAliases(context)).toEqual(['Level']))
			expect(second.lines(1).slice(0, 2)).toEqual(['defaultuser', 'password'])
		} finally {
			await instance.destroy()
			await second.close()
		}
	})

	it('drops a command whose action signal aborts before its turn', async () => {
		const created = createInstance({ ...TIMING, messageInterval: 50 })
		await created.instance.init(config(), false, SECRETS)
		await vi.waitFor(() => expect(created.context.updateStatus).toHaveBeenCalledWith(InstanceStatus.Ok, 'Logged in'))
		const controller = new AbortController()
		const call = created.instance.sendCommand('cg "Abort me"', controller.signal)
		controller.abort()
		await expect(call).rejects.toThrow()
		await sleep(400)
		expect(fake.lines(1)).not.toContain('cg "Abort me"')
	})
})
