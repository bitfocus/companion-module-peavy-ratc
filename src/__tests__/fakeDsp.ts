import { createServer, type Server, type Socket } from 'node:net'

// Written out here rather than taken from the module under test
const EOL = '\r\n'
const BEL = '\x07'

export interface ReceivedLine {
	/** Which connection it came on, counting from 1 */
	connection: number
	text: string
}

export interface Control {
	/** As the DSP reports it, with its units */
	value: string
	position: number
}

/**
 * A NION on a loopback TCP port, speaking RATCv1 or RATCv2, for the module to connect to. It answers logins, the control
 * list and control gets and sets from the state held here.
 *
 * These replies are synthetic, not captured from a DSP: they follow the reply forms the module was written against.
 * Replace them with captures when a DSP is to hand.
 */
export class FakeDsp {
	readonly received: ReceivedLine[] = []
	version: 'v1' | 'v2' = 'v2'
	username = 'defaultuser'
	password = 'password'
	/** Sends error replies flagged as alerts, with a BEL before them */
	alertErrors = false
	/** Off, logins are ignored rather than answered */
	answerLogins = true
	readonly controls = new Map<string, Control>([
		['Gain 1', { value: '-10.0dB', position: 0.5 }],
		['Mute 1', { value: 'off', position: 0 }],
	])
	/** RATCv2 RAW mode paths, listed as well as the controls, but never given a value */
	rawAliases: string[] = []
	port = 0
	/** Connections accepted so far */
	connections = 0
	readonly #server: Server
	readonly #sockets = new Set<Socket>()
	/** RATCv1 takes the username and password a line each, so the username is held until the password comes */
	readonly #v1Username = new Map<Socket, string>()
	readonly #loggedIn = new Set<Socket>()

	constructor() {
		this.#server = createServer((socket) => {
			this.connections++
			const connection = this.connections
			this.#sockets.add(socket)
			if (this.version === 'v1') this.#write(socket, 'Name:')
			let buffer = ''
			socket.on('data', (chunk: Buffer) => {
				buffer += chunk.toString('utf8')
				let end: number
				while ((end = buffer.indexOf(EOL)) !== -1) {
					const text = buffer.slice(0, end)
					buffer = buffer.slice(end + EOL.length)
					this.received.push({ connection, text })
					this.#answer(socket, text)
				}
			})
			socket.on('close', () => {
				this.#sockets.delete(socket)
				this.#loggedIn.delete(socket)
				this.#v1Username.delete(socket)
			})
			socket.on('error', () => {})
		})
	}

	async listen(): Promise<void> {
		await new Promise<void>((resolve) => this.#server.listen(0, '127.0.0.1', resolve))
		const address = this.#server.address()
		if (!address || typeof address === 'string') throw new Error('fake DSP did not get a port')
		this.port = address.port
	}

	async close(): Promise<void> {
		this.dropConnections()
		await new Promise<void>((resolve) => this.#server.close(() => resolve()))
	}

	/** Closes every connection from the DSP's end */
	dropConnections(): void {
		for (const socket of this.#sockets) socket.destroy()
	}

	/** Writes a line to every connection */
	broadcast(line: string): void {
		for (const socket of this.#sockets) socket.write(line + EOL, 'utf8')
	}

	/** The lines received, in order, optionally only those on one connection */
	lines(connection?: number): string[] {
		return this.received.filter((r) => connection === undefined || r.connection === connection).map((r) => r.text)
	}

	#write(socket: Socket, line: string): void {
		if (!socket.destroyed) socket.write(line + EOL, 'utf8')
	}

	#error(socket: Socket, line: string): void {
		this.#write(socket, (this.alertErrors ? BEL : '') + line)
	}

	#valueIs(socket: Socket, alias: string): void {
		const control = this.controls.get(alias)
		if (control === undefined) {
			this.#error(socket, this.version === 'v1' ? `BadCommand "${alias}"` : `unlistedControl "${alias}"`)
		} else if (this.version === 'v1') {
			this.#write(socket, `valueIs "${alias}" ${control.value}`)
		} else {
			this.#write(socket, `valueIs "${alias}" ${control.value} ${control.position}`)
		}
	}

	#answer(socket: Socket, text: string): void {
		if (this.version === 'v1') this.#answerV1(socket, text)
		else this.#answerV2(socket, text)
	}

	#answerV1(socket: Socket, text: string): void {
		if (!this.#loggedIn.has(socket)) {
			const username = this.#v1Username.get(socket)
			if (username === undefined) {
				this.#v1Username.set(socket, text)
				this.#write(socket, 'Password:')
			} else if (!this.answerLogins) {
				return
			} else if (username === this.username && text === this.password) {
				this.#loggedIn.add(socket)
				this.#write(socket, 'RATCVersion 1.0')
				this.#write(socket, 'Welcome')
			} else {
				this.#v1Username.delete(socket)
				this.#error(socket, 'LoginFailed')
				this.#write(socket, 'Name:')
			}
			return
		}
		const alias = /"([^"]*)"/.exec(text)?.[1] ?? ''
		const [command] = text.split(' ')
		switch (command) {
			case 'statusGet':
				this.#write(socket, 'statusIs 1 "Fake Project"')
				break
			case 'controlList':
				for (const name of this.controls.keys()) this.#write(socket, `{ group: "${name}" }`)
				break
			case 'controlGet':
				this.#valueIs(socket, alias)
				break
			case 'controlSet': {
				const control = this.controls.get(alias)
				if (control !== undefined) control.value = text.split(' ').at(-1) ?? ''
				this.#valueIs(socket, alias)
				break
			}
			case 'changeGroupAddControl':
				this.#write(socket, `addedToChangeGroup "${alias}"`)
				break
			case 'changeGroupGet':
				this.#write(socket, 'numberOfChanges 0')
				break
			default:
				this.#error(socket, `BadCommand ${text}`)
		}
	}

	#answerV2(socket: Socket, text: string): void {
		const [command, ...params] = text.split(' ')
		if (command === 'li') {
			if (!this.answerLogins) return
			if (params[0] === this.username && params[1] === this.password) {
				this.#loggedIn.add(socket)
				this.#write(socket, 'loggedIn')
			} else {
				this.#error(socket, 'loginFailed')
			}
			return
		}
		if (!this.#loggedIn.has(socket)) {
			this.#error(socket, 'notLoggedIn')
			return
		}
		const alias = /"([^"]*)"/.exec(text)?.[1] ?? ''
		switch (command) {
			case 'sg':
				this.#write(socket, 'statusIs 1 "Fake Project"')
				break
			case 'ka':
				this.#write(socket, `keepAlive ${params[0]}`)
				break
			case 'qmd':
				this.#write(socket, 'quietModeDisabled')
				break
			case 'cl':
				for (const name of [...this.controls.keys(), ...this.rawAliases]) this.#write(socket, `"${name}"`)
				break
			case 'cg':
				this.#valueIs(socket, alias)
				break
			case 'cs':
			case 'cps': {
				const control = this.controls.get(alias)
				const value = text.split(' ').at(-1) ?? ''
				if (control !== undefined && command === 'cs') control.value = value
				if (control !== undefined && command === 'cps') control.position = Number(value)
				this.#valueIs(socket, alias)
				break
			}
			case 'cgca':
				this.#write(socket, `changeGroupControlAdded ${params.join(' ')}`)
				break
			case 'cgs':
				this.#write(socket, `changeGroupSchedule ${params.join(' ')}`)
				break
			case 'cgg':
				this.#write(socket, 'changeGroupChanges 0')
				break
			default:
				this.#error(socket, `badCommand ${text}`)
		}
	}
}

/** A port nothing is listening on */
export async function closedPort(): Promise<number> {
	const dsp = new FakeDsp()
	await dsp.listen()
	const { port } = dsp
	await dsp.close()
	return port
}
