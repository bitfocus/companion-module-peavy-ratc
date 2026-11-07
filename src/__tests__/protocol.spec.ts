import { describe, expect, it } from 'vitest'
import {
	changeGroupClear,
	changeGroupControlAdd,
	changeGroupControlRemove,
	changeGroupGet,
	controlGet,
	controlPositionSet,
	controlSet,
	controlSetString,
	controlStep,
	loginLines,
	onLoginCommands,
	quote,
} from '../protocol.js'

describe('control commands', () => {
	it('spells RATCv1 controlSet in full', () => {
		// It was sent as controSet, which a DSP rejects
		expect(controlSet('v1', 'Gain 1', -3)).toBe('controlSet "Gain 1" -3.000')
		expect(controlSet('v2', 'Gain 1', -3)).toBe('cs "Gain 1" -3.000')
	})

	it('sends values and positions to 3 decimal places', () => {
		expect(controlPositionSet('Gain 1', 0.12345)).toBe('cps "Gain 1" 0.123')
		expect(controlStep('Gain 1', 0.5, '--')).toBe('cs "Gain 1" --0.500')
	})

	it('quotes a string value', () => {
		expect(controlSetString('v2', 'Label', 'Hello there')).toBe('cs "Label" "Hello there"')
		expect(controlGet('v1', 'Label')).toBe('controlGet "Label"')
	})

	it('refuses a parameter holding a quote, which would end it early', () => {
		expect(() => controlGet('v2', 'Gain "1"')).toThrow('Alias must not contain "')
		expect(() => controlSetString('v2', 'Label', 'say "hi"')).toThrow('String must not contain "')
		expect(() => changeGroupGet('v2', 'a"b')).toThrow('Change group must not contain "')
		expect(quote('x')).toBe('"x"')
	})
})

describe('change group commands', () => {
	it('name a RATCv2 group before the alias, and leave it out for the default group', () => {
		expect(changeGroupControlAdd('v2', 'Gain 1', 'Mine')).toBe('cgca "Mine" "Gain 1"')
		expect(changeGroupControlAdd('v2', 'Gain 1', '')).toBe('cgca "Gain 1"')
		// Remove put the group after the alias, as `cgcr "Gain 1"Mine" "`
		expect(changeGroupControlRemove('v2', 'Gain 1', 'Mine')).toBe('cgcr "Mine" "Gain 1"')
		expect(changeGroupControlRemove('v2', 'Gain 1')).toBe('cgcr "Gain 1"')
		expect(changeGroupGet('v2', 'Mine')).toBe('cgg "Mine"')
		expect(changeGroupClear('v2', 'Mine')).toBe('cgc "Mine"')
		expect(changeGroupClear('v2')).toBe('cgc')
	})

	it('leave the group out for RATCv1, which has only the one', () => {
		expect(changeGroupControlAdd('v1', 'Gain 1', 'Mine')).toBe('changeGroupAddControl "Gain 1"')
		expect(changeGroupControlRemove('v1', 'Gain 1', 'Mine')).toBe('changeGroupRemoveControl "Gain 1"')
		expect(changeGroupGet('v1', 'Mine')).toBe('changeGroupGet')
		expect(changeGroupClear('v1', 'Mine')).toBe('changeGroupClear')
	})
})

describe('logging in', () => {
	it('sends RATCv1 the username and password a line each', () => {
		expect(loginLines('v1', 'user', 'pass')).toEqual(['user', 'pass'])
	})

	it('sends RATCv2 a logIn, leaving out what is empty', () => {
		expect(loginLines('v2', 'user', 'pass')).toEqual(['li user pass'])
		expect(loginLines('v2', 'user', '')).toEqual(['li user'])
		expect(loginLines('v2', '', 'pass')).toEqual(['li'])
	})

	it('asks for the status and control list, and for RATCv2 sets up the session', () => {
		expect(onLoginCommands('v1')).toEqual(['statusGet', 'controlList'])
		expect(onLoginCommands('v2')).toEqual(['sg', 'ka 30', 'qmd', 'cl', 'cgs 1'])
	})
})
