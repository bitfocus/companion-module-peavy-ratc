import { EventEmitter } from 'node:events'
import { StringDecoder } from 'node:string_decoder'
import { InstanceStatus, TCPHelper, type LogLevel } from '@companion-module/base'
import PQueue from 'p-queue'
import { EOM, type RatcVersion } from './consts.js'
import { parseReply, type ParsedReply } from './parse.js'
import { loginLines } from './protocol.js'
import { errorMessage } from './utils.js'

export interface ConnectionTiming {
	/** Least time from sending one command to sending the next. The DSP asks for at least 20 ms */
	messageInterval: number
	/** How often the keep alive is sent once logged in */
	keepAliveInterval: number
	reconnectInterval: number
}

export const DEFAULT_TIMING: ConnectionTiming = {
	messageInterval: 20,
	keepAliveInterval: 10000,
	reconnectInterval: 2000,
}

export interface ConnectionOptions {
	host: string
	port: number
	version: RatcVersion
	username: string
	password: string
	log: (level: LogLevel, message: string) => void
	/** Sent every keep alive interval while logged in. It keeps the session open, and polls the default change group */
	keepAliveCommand: () => string
	/** Defaults to {@link DEFAULT_TIMING}. Tests shorten it */
	timing?: Partial<ConnectionTiming>
}

/** The replies the connection handles itself, as they are about logging in */
type LoginReplyType = 'loggedIn' | 'loginFailed' | 'notLoggedIn' | 'loginPrompt'
export type SessionReply = Exclude<ParsedReply, { type: LoginReplyType }>

export interface ConnectionEvents {
	/** Logged in, and commands can be sent. Fires again on every reconnection */
	ready: []
	/** A line from the DSP that is not about logging in */
	reply: [reply: SessionReply]
	status: [status: InstanceStatus, message: string | null]
}

export const LOGIN_FAILED = 'Username / Password is incorrect'
export const WRONG_VERSION = 'Device in RATCv1 mode'

/**
 * The RATC control connection to a DSP: framing, login, pacing, keep alive and reconnection. Knows nothing of Companion
 * beyond reporting a status for it.
 */
export class RatcConnection extends EventEmitter<ConnectionEvents> {
	readonly #options: ConnectionOptions
	readonly #timing: ConnectionTiming
	readonly #queue: PQueue
	#socket: TCPHelper | undefined
	#decoder = new StringDecoder('utf8')
	#buffer = ''
	/** Exists while logged in, and is aborted as the session ends, which drops everything queued for it */
	#session: AbortController | undefined
	#keepAliveTimer: NodeJS.Timeout | undefined
	#keepAliveQueued = false
	/** The login is sent again once if the DSP says it is not logged in. Set until the next login succeeds */
	#reloginSent = false
	/** Set by the first failure of an outage, so retries against a DSP that is off don't flood the log */
	#outageLogged = false
	#destroyed = false

	constructor(options: ConnectionOptions) {
		super()
		this.#options = options
		this.#timing = { ...DEFAULT_TIMING, ...options.timing }
		this.#queue = new PQueue({ concurrency: 1, interval: this.#timing.messageInterval, intervalCap: 1 })
	}

	/** Logged in, so commands can be sent */
	get isReady(): boolean {
		return this.#session !== undefined
	}

	/** Opens the connection. After that, TCPHelper reconnects by itself */
	connect(): void {
		if (this.#destroyed) throw new Error('Connection has been destroyed')
		this.#closeSocket()
		const { host, port } = this.#options
		this.#status(InstanceStatus.Connecting, `Connecting to ${host}:${port}`)
		const socket = new TCPHelper(host, port, { reconnect: true, reconnect_interval: this.#timing.reconnectInterval })
		this.#socket = socket
		socket.on('connect', () => this.#onConnect())
		socket.on('data', (chunk) => this.#receive(chunk))
		socket.on('end', () => {
			this.#endSession()
			this.#status(InstanceStatus.Disconnected, 'Connection closed by device')
			this.#logOutage('warn', `Connection closed by ${host}:${port}`)
		})
		socket.on('error', (err) => {
			this.#endSession()
			this.#status(InstanceStatus.ConnectionFailure, err.message)
			this.#logOutage('error', `Network error: ${err.message}`)
		})
	}

	/** Closes the connection for good. Anything still queued is rejected */
	destroy(): void {
		this.#destroyed = true
		this.removeAllListeners()
		this.#closeSocket()
	}

	/**
	 * Queues a command for the DSP
	 * @param signal an action's context.signal. A command whose signal aborts before its turn is never sent
	 * @returns once the command is written to the socket
	 * @throws if not logged in, or the session ends or the signal aborts before the command is sent
	 */
	async send(command: string, signal?: AbortSignal): Promise<void> {
		const session = this.#session
		if (session === undefined) throw new Error('Not logged in to DSP')
		// p-queue listens on the combined signal from the moment the job is queued, which makes it pass an abort on
		// eagerly. Only reading .aborted could miss one: AbortSignal.any holds its sources weakly
		const combined = signal ? AbortSignal.any([session.signal, signal]) : session.signal
		await this.#queue.add(
			async ({ signal: jobSignal }) => {
				jobSignal?.throwIfAborted()
				const socket = this.#socket
				if (!socket?.isConnected || !(await socket.sendAsync(command + EOM))) throw new Error('Not connected to DSP')
				this.#options.log('debug', `Sending command: ${command}`)
			},
			{ signal: combined },
		)
	}

	#onConnect(): void {
		this.#endSession()
		const { host, port, version, username, password } = this.#options
		this.#decoder = new StringDecoder('utf8')
		this.#buffer = ''
		this.#reloginSent = false
		this.#options.log('info', `Connected to ${host}:${port}`)
		this.#status(InstanceStatus.Connecting, 'Logging in')
		this.#logIn(version, username, password)
	}

	/** Writes the login straight to the socket, outside the queue, which only runs once logged in */
	#logIn(version: RatcVersion, username: string, password: string): void {
		for (const line of loginLines(version, username, password)) this.#socket?.send(line + EOM)
	}

	#receive(chunk: Buffer): void {
		this.#buffer += this.#decoder.write(chunk)
		const lines = this.#buffer.split(EOM)
		this.#buffer = lines.pop() ?? ''
		for (const line of lines) {
			try {
				this.#onReply(parseReply(line))
			} catch (err) {
				// This runs in the socket's data listener, where a throw would end the module's process
				this.#options.log('error', `Could not handle reply ${line}: ${errorMessage(err)}`)
			}
		}
	}

	#onReply(reply: ParsedReply): void {
		switch (reply.type) {
			case 'loggedIn':
				this.#options.log('info', `Logged in: ${reply.text}`)
				if (this.#session === undefined) this.#startSession()
				return
			case 'loginFailed':
				this.#endSession()
				this.#status(InstanceStatus.AuthenticationFailure, LOGIN_FAILED)
				this.#options.log('error', `${LOGIN_FAILED}: ${reply.text}`)
				return
			case 'notLoggedIn':
				this.#options.log('error', reply.text)
				this.#endSession()
				if (this.#reloginSent) {
					this.#status(InstanceStatus.BadConfig, reply.text)
				} else {
					this.#reloginSent = true
					this.#status(InstanceStatus.Connecting, 'Logging in')
					const { version, username, password } = this.#options
					this.#logIn(version, username, password)
				}
				return
			case 'loginPrompt':
				if (this.#options.version === 'v2') {
					this.#endSession()
					this.#status(InstanceStatus.BadConfig, WRONG_VERSION)
					this.#options.log('error', WRONG_VERSION)
				} else {
					// The username and password went on connecting, so the prompt needs no answer
					this.#options.log('debug', reply.text)
				}
				return
			default:
				this.emit('reply', reply)
		}
	}

	#startSession(): void {
		this.#session = new AbortController()
		this.#reloginSent = false
		this.#outageLogged = false
		this.#status(InstanceStatus.Ok, 'Logged in')
		this.#keepAliveTimer = setInterval(() => this.#keepAlive(), this.#timing.keepAliveInterval)
		this.emit('ready')
	}

	/** Ends the session, if one is open: everything queued for it is rejected, and the keep alive stopped */
	#endSession(): void {
		const session = this.#session
		if (session === undefined) return
		this.#session = undefined
		clearInterval(this.#keepAliveTimer)
		this.#keepAliveTimer = undefined
		session.abort(new Error('Session with DSP ended'))
	}

	#closeSocket(): void {
		this.#endSession()
		// TCPHelper's destroy removes its listeners first, so the old socket can't report anything once replaced
		this.#socket?.destroy()
		this.#socket = undefined
		this.#buffer = ''
	}

	/** Skipped while the last is still queued, so keep alives can't pile up behind a long burst of commands */
	#keepAlive(): void {
		if (this.#keepAliveQueued) return
		this.#keepAliveQueued = true
		this.send(this.#options.keepAliveCommand())
			// Its only failure is the session ending, which is reported already
			.catch((err) => this.#options.log('debug', `Keep alive not sent: ${errorMessage(err)}`))
			.finally(() => (this.#keepAliveQueued = false))
	}

	#status(status: InstanceStatus, message: string | null): void {
		this.emit('status', status, message)
	}

	#logOutage(level: LogLevel, message: string): void {
		this.#options.log(this.#outageLogged ? 'debug' : level, message)
		this.#outageLogged = true
	}
}
