import type { LogLevel } from '@companion-module/base'
import { ALERT, PARAM_SEP, QUOTE, cmd, resp } from './consts.js'

/** A line from the DSP, by what the module does with it. `text` is the line as received, trimmed */
export type ParsedReply =
	/** A control alias from the control list */
	| { type: 'alias'; alias: string; text: string }
	/**
	 * A control's value, and for RATCv2 its position from 0 to 1. A value is kept as text, with its units, and is cut
	 * at the first space unless the DSP quotes it
	 */
	| { type: 'value'; alias: string; value: string; position: number | undefined; text: string }
	/** RATCv1's prompt for a username */
	| { type: 'loginPrompt'; text: string }
	/** RATCv2's loggedIn, or RATCv1's Welcome */
	| { type: 'loggedIn'; text: string }
	| { type: 'loginFailed'; text: string }
	/** RATCv2: a command was sent without being logged in */
	| { type: 'notLoggedIn'; text: string }
	| { type: 'quietModeEnabled'; text: string }
	| { type: 'quietModeDisabled'; text: string }
	| { type: 'overflow'; text: string }
	/** RATCv1: no project is running */
	| { type: 'notRunning'; text: string }
	/** Needs nothing doing beyond logging it */
	| { type: 'log'; level: LogLevel; text: string }
	| { type: 'unknown'; text: string }

/** Commands the DSP echoes back, in either version and either form */
const ECHOES: ReadonlySet<string> = new Set<string>([
	...Object.values(cmd.v1),
	...Object.values(cmd.v2),
	...Object.values(cmd.v2Long),
])

const LOG_LEVELS: Readonly<Record<string, LogLevel>> = {
	[resp.v1.ratcVersion]: 'info',
	[resp.v1.statusIs]: 'info',
	[resp.v1.badArgumentCount]: 'warn',
	[resp.v2.badArgumentCount]: 'warn',
	[resp.v1.unlistedGroup]: 'warn',
	[resp.v1.addedToChangeGroup]: 'debug',
	[resp.v1.removedFromChangeGroup]: 'debug',
	[resp.v1.invalidChangeGroup]: 'warn',
	[resp.v2.invalidChangeGroup]: 'warn',
	[resp.v1.clearedChangeGroup]: 'debug',
	// The replies to the keep alive's change group gets, every few seconds
	[resp.v1.numberOfChanges]: 'debug',
	[resp.v2.changeGroupChanges]: 'debug',
	[resp.v1.badCommand]: 'warn',
	[resp.v2.badCommand]: 'warn',
	[resp.v1.password]: 'debug',
	[resp.v1.endControlGroupList]: 'debug',
	[resp.v2.keepAlive]: 'debug',
	[resp.v2.changeGroupControlAdded]: 'debug',
	[resp.v2.changeGroupControlRemoved]: 'debug',
	[resp.v2.changeGroupCleared]: 'debug',
	[resp.v2.changeGroupSchedule]: 'debug',
	[resp.v2.unlistedControl]: 'warn',
	[resp.v2.commandFailed]: 'error',
	[resp.v2.commandUnsupported]: 'warn',
}

/** A number, or undefined for anything that is not one */
function toNumber(text: string | undefined): number | undefined {
	if (text === undefined || text.trim() === '') return undefined
	const value = Number(text)
	return Number.isFinite(value) ? value : undefined
}

/** The text between the first quote and the next, or to the end if there is no closing quote */
function firstQuoted(text: string): { quoted: string; rest: string } | undefined {
	const open = text.indexOf(QUOTE)
	if (open === -1) return undefined
	const close = text.indexOf(QUOTE, open + 1)
	if (close === -1) return { quoted: text.slice(open + 1), rest: '' }
	return { quoted: text.slice(open + 1, close), rest: text.slice(close + 1).trim() }
}

/** `valueIs "alias" value [position]`, where the value may be quoted */
function parseValue(text: string): ParsedReply {
	const alias = firstQuoted(text)
	if (alias === undefined) return { type: 'unknown', text }
	let value: string
	let tail: string[]
	if (alias.rest.startsWith(QUOTE)) {
		const quoted = firstQuoted(alias.rest)
		value = quoted?.quoted ?? ''
		tail = (quoted?.rest ?? '').split(/\s+/).filter(Boolean)
	} else {
		const tokens = alias.rest.split(/\s+/).filter(Boolean)
		value = tokens[0] ?? ''
		tail = tokens.slice(1)
	}
	return { type: 'value', alias: alias.quoted, value, position: toNumber(tail.at(-1)), text }
}

function parseLine(text: string): ParsedReply {
	if (text.startsWith(QUOTE)) {
		const alias = firstQuoted(text)?.quoted ?? ''
		return alias === '' ? { type: 'unknown', text } : { type: 'alias', alias, text }
	}
	const params = text.split(PARAM_SEP)
	const first = params[0]
	// The prompt can follow other text on the line
	if (params.at(-1) === resp.v1.username) return { type: 'loginPrompt', text }
	switch (first) {
		case resp.v1.valueIs:
			return parseValue(text)
		case resp.v1.welcome:
		case resp.v2.loggedIn:
			return { type: 'loggedIn', text }
		case resp.v1.loginFailed:
		case resp.v2.loginFailed:
			return { type: 'loginFailed', text }
		case resp.v2.notLoggedIn:
			return { type: 'notLoggedIn', text }
		case resp.v1.overflow:
		case resp.v2.overflow:
			return { type: 'overflow', text }
		case resp.v1.notRunning:
			return { type: 'notRunning', text }
		case resp.v2.quietModeEnabled:
			return { type: 'quietModeEnabled', text }
		case resp.v2.quietModeDisabled:
			return { type: 'quietModeDisabled', text }
		case resp.v1.startControlGroupList: {
			// RATCv1 lists the aliases as `{ group: "alias"`
			const alias = params[1] === resp.v1.aliasControlGroupList ? firstQuoted(text)?.quoted : undefined
			return alias ? { type: 'alias', alias, text } : { type: 'log', level: 'debug', text }
		}
	}
	const level = LOG_LEVELS[first]
	if (level !== undefined) return { type: 'log', level, text }
	if (ECHOES.has(first)) return { type: 'log', level: 'debug', text }
	// A failed login can come with something before it on the line
	if (text.includes(resp.v1.loginFailed) || text.includes(resp.v2.loginFailed)) return { type: 'loginFailed', text }
	return { type: 'unknown', text }
}

/**
 * Parses a line from the DSP, without its line ending. A line flagged as an alert is parsed as if it were not, and
 * logged as a warning at least.
 */
export function parseReply(line: string): ParsedReply {
	let text = line.trim()
	let alert = false
	while (text.startsWith(ALERT)) {
		alert = true
		text = text.slice(ALERT.length).trim()
	}
	const reply = parseLine(text)
	if (alert && reply.type === 'log' && (reply.level === 'debug' || reply.level === 'info')) {
		return { ...reply, level: 'warn' }
	}
	return reply
}
