import { describe, expect, it } from 'vitest'
import { parseReply } from '../parse.js'

// These lines are synthetic, not captured from a DSP: they follow the reply forms the module was written against

describe('control lists', () => {
	it('reads a RATCv2 alias line, which is the alias in quotes', () => {
		expect(parseReply('"Gain 1"')).toEqual({ type: 'alias', alias: 'Gain 1', text: '"Gain 1"' })
		expect(parseReply('"//devices/10/controls/hold_time"')).toMatchObject({
			type: 'alias',
			alias: '//devices/10/controls/hold_time',
		})
	})

	it('reads a RATCv1 alias line', () => {
		expect(parseReply('{ group: "Mute 1" }')).toMatchObject({ type: 'alias', alias: 'Mute 1' })
		expect(parseReply('{')).toMatchObject({ type: 'log', level: 'debug' })
		expect(parseReply('}')).toMatchObject({ type: 'log', level: 'debug' })
	})

	it('takes an empty alias as unknown', () => {
		expect(parseReply('""')).toMatchObject({ type: 'unknown' })
	})
})

describe('values', () => {
	it('reads a RATCv2 value and position', () => {
		expect(parseReply('valueIs "Gain 1" -10.0dB 0.500')).toEqual({
			type: 'value',
			alias: 'Gain 1',
			value: '-10.0dB',
			position: 0.5,
			text: 'valueIs "Gain 1" -10.0dB 0.500',
		})
	})

	it('reads a RATCv1 value, which has no position', () => {
		expect(parseReply('valueIs "Gain 1" -10.0')).toMatchObject({ value: '-10.0', position: undefined })
	})

	it('cuts an unquoted value at the first space, and keeps a quoted one whole', () => {
		expect(parseReply('valueIs "Label" hello world 0')).toMatchObject({ value: 'hello', position: 0 })
		expect(parseReply('valueIs "Label" "hello world" 0')).toMatchObject({ value: 'hello world', position: 0 })
	})

	it('has no position where the last word is not a number', () => {
		expect(parseReply('valueIs "Mute 1" off on')).toMatchObject({ value: 'off', position: undefined })
	})

	it('reads a value line with nothing after the alias as an empty value', () => {
		expect(parseReply('valueIs "Gain 1"')).toMatchObject({ type: 'value', value: '', position: undefined })
		expect(parseReply('valueIs Gain')).toMatchObject({ type: 'unknown' })
	})
})

describe('logging in', () => {
	it('reads either version logging in, failing to, or prompting for a name', () => {
		expect(parseReply('loggedIn')).toMatchObject({ type: 'loggedIn' })
		expect(parseReply('Welcome to RATC')).toMatchObject({ type: 'loggedIn' })
		expect(parseReply('loginFailed')).toMatchObject({ type: 'loginFailed' })
		expect(parseReply('LoginFailed')).toMatchObject({ type: 'loginFailed' })
		expect(parseReply('notLoggedIn')).toMatchObject({ type: 'notLoggedIn' })
		expect(parseReply('Name:')).toMatchObject({ type: 'loginPrompt' })
		expect(parseReply('RATC Server Name:')).toMatchObject({ type: 'loginPrompt' })
	})

	it('finds a failed login with something before it on the line', () => {
		expect(parseReply('> loginFailed')).toMatchObject({ type: 'loginFailed' })
	})
})

describe('alerts', () => {
	it('parses a line the DSP flags with a BEL as it would the line without', () => {
		// The module once compared the line's first character with the number 7, which never matched
		expect(parseReply('\x07loginFailed')).toMatchObject({ type: 'loginFailed', text: 'loginFailed' })
		expect(parseReply('\x07unlistedControl "Gain 9"')).toEqual({
			type: 'log',
			level: 'warn',
			text: 'unlistedControl "Gain 9"',
		})
	})

	it('logs a flagged line as a warning at least', () => {
		expect(parseReply('\x07statusIs 1')).toMatchObject({ type: 'log', level: 'warn' })
		expect(parseReply('\x07commandFailed')).toMatchObject({ type: 'log', level: 'error' })
		expect(parseReply('statusIs 1')).toMatchObject({ type: 'log', level: 'info' })
	})
})

describe('everything else', () => {
	it('reads the replies the module acts on', () => {
		expect(parseReply('overflow')).toMatchObject({ type: 'overflow' })
		expect(parseReply('Overflow')).toMatchObject({ type: 'overflow' })
		expect(parseReply('NotRunning')).toMatchObject({ type: 'notRunning' })
		expect(parseReply('quietModeEnabled')).toMatchObject({ type: 'quietModeEnabled' })
		expect(parseReply('quietModeDisabled')).toMatchObject({ type: 'quietModeDisabled' })
	})

	it('logs acknowledgements, errors and echoed commands at their levels', () => {
		expect(parseReply('changeGroupChanges 0')).toMatchObject({ type: 'log', level: 'debug' })
		expect(parseReply('numberOfChanges 0')).toMatchObject({ type: 'log', level: 'debug' })
		expect(parseReply('badCommand xyz')).toMatchObject({ type: 'log', level: 'warn' })
		expect(parseReply('BadCommand xyz')).toMatchObject({ type: 'log', level: 'warn' })
		expect(parseReply('commandFailed')).toMatchObject({ type: 'log', level: 'error' })
		expect(parseReply('cgg')).toMatchObject({ type: 'log', level: 'debug' })
		expect(parseReply('changeGroupControlAdd "Gain 1"')).toMatchObject({ type: 'log', level: 'debug' })
	})

	it('takes anything else as unknown', () => {
		expect(parseReply('  something else  ')).toEqual({ type: 'unknown', text: 'something else' })
	})
})
