import { describe, expect, it } from 'vitest'
import type { CompanionOptionValues } from '@companion-module/base'
import { ActionId } from '../actions.js'
import type { RatcVersion } from '../consts.js'
import { actionDefinitions, definition, fakeInstance, runAction, subscribeAction } from './fixtures.js'

const V2_ONLY = [ActionId.ControlSetInc, ActionId.ControlPositionSet, ActionId.ControlPositionInvert]

describe('definitions', () => {
	it('offers every action for RATCv2, and leaves out those RATCv1 has no command for', () => {
		const v2 = actionDefinitions(fakeInstance('v2'))
		for (const id of Object.values(ActionId)) expect(v2[id], id).toBeTruthy()
		const v1 = actionDefinitions(fakeInstance('v1'))
		for (const id of Object.values(ActionId)) {
			if (V2_ONLY.includes(id)) expect(v1[id], id).toBeUndefined()
			else expect(v1[id], id).toBeTruthy()
		}
	})

	it('offers the aliases the DSP listed, and any other typed in', () => {
		const defs = actionDefinitions(fakeInstance('v2', ['Gain 1', 'Mute 1']))
		const alias = definition(defs, ActionId.ControlGet).options.find((o) => o.id === 'alias')
		expect(alias).toMatchObject({
			type: 'dropdown',
			allowCustom: true,
			choices: [
				{ id: 'Gain 1', label: 'Gain 1' },
				{ id: 'Mute 1', label: 'Mute 1' },
			],
		})
	})

	it('names a change group for RATCv2 only', () => {
		const optionIds = (version: RatcVersion, id: ActionId) =>
			definition(actionDefinitions(fakeInstance(version)), id).options.map((o) => o.id)
		expect(optionIds('v2', ActionId.ChangeGroupControlRemove)).toEqual(['alias', 'changeGroup'])
		expect(optionIds('v1', ActionId.ChangeGroupControlRemove)).toEqual(['alias'])
		expect(optionIds('v2', ActionId.ChangeGroupClear)).toEqual(['changeGroup'])
		expect(optionIds('v1', ActionId.ChangeGroupClear)).toEqual([])
	})
})

describe('callbacks', () => {
	const cases: [RatcVersion, ActionId, CompanionOptionValues, string][] = [
		['v2', ActionId.StatusGet, {}, 'sg'],
		['v1', ActionId.StatusGet, {}, 'statusGet'],
		['v2', ActionId.ControlGet, { alias: 'Gain 1' }, 'cg "Gain 1"'],
		['v1', ActionId.ControlGet, { alias: 'Gain 1' }, 'controlGet "Gain 1"'],
		['v2', ActionId.ControlSet, { alias: 'Gain 1', value: -6 }, 'cs "Gain 1" -6.000'],
		['v1', ActionId.ControlSet, { alias: 'Gain 1', value: -6 }, 'controlSet "Gain 1" -6.000'],
		['v2', ActionId.ControlSetInc, { alias: 'Gain 1', value: 1.5, pos: '++' }, 'cs "Gain 1" ++1.500'],
		['v2', ActionId.ControlSetInc, { alias: 'Gain 1', value: 1.5, pos: '--' }, 'cs "Gain 1" --1.500'],
		['v2', ActionId.ControlPositionSet, { alias: 'Gain 1', value: 0.25 }, 'cps "Gain 1" 0.250'],
		['v2', ActionId.ControlPositionInvert, { alias: 'Mute 1', value: 1 }, 'cps "Mute 1" 0.000'],
		['v2', ActionId.ControlPositionInvert, { alias: 'Mute 1', value: 0.25 }, 'cps "Mute 1" 0.750'],
		['v2', ActionId.ChangeGroupControlAdd, { alias: 'Gain 1', changeGroup: 'Mine' }, 'cgca "Mine" "Gain 1"'],
		['v2', ActionId.ChangeGroupControlAdd, { alias: 'Gain 1', changeGroup: '' }, 'cgca "Gain 1"'],
		['v1', ActionId.ChangeGroupControlAdd, { alias: 'Gain 1' }, 'changeGroupAddControl "Gain 1"'],
		['v2', ActionId.ChangeGroupControlRemove, { alias: 'Gain 1', changeGroup: 'Mine' }, 'cgcr "Mine" "Gain 1"'],
		['v1', ActionId.ChangeGroupControlRemove, { alias: 'Gain 1' }, 'changeGroupRemoveControl "Gain 1"'],
		['v2', ActionId.ChangeGroupClear, { changeGroup: 'Mine' }, 'cgc "Mine"'],
		['v2', ActionId.ChangeGroupClear, { changeGroup: '' }, 'cgc'],
		['v1', ActionId.ChangeGroupClear, {}, 'changeGroupClear'],
	]

	it.each(cases)('%s %s %o sends %s', async (version, actionId, options, command) => {
		const fake = fakeInstance(version)
		const signal = new AbortController().signal
		await runAction(actionDefinitions(fake), actionId, options, signal)
		expect(fake.sendCommand).toHaveBeenCalledExactlyOnceWith(command, signal)
	})

	it('sets a string control to the string option', async () => {
		// It read the value option, as a number, and then threw calling indexOf on it
		const fake = fakeInstance('v2')
		await runAction(actionDefinitions(fake), ActionId.ControlSetString, { alias: 'Label', string: 'Hello there' })
		expect(fake.sendCommand).toHaveBeenCalledWith('cs "Label" "Hello there"', expect.any(AbortSignal))
	})

	it('sends a number an expression gave as text', async () => {
		const fake = fakeInstance('v1')
		const defs = actionDefinitions(fake)
		await runAction(defs, ActionId.ControlSetString, { alias: 42, string: 7 })
		expect(fake.sendCommand).toHaveBeenCalledWith('controlSet "42" "7"', expect.any(AbortSignal))
	})

	it('refuses what the DSP could not take, sending nothing', async () => {
		const fake = fakeInstance('v2')
		const defs = actionDefinitions(fake)
		await expect(runAction(defs, ActionId.ControlGet, { alias: '' })).rejects.toThrow('No control alias')
		await expect(runAction(defs, ActionId.ControlGet, { alias: 'a"b' })).rejects.toThrow('must not contain')
		await expect(runAction(defs, ActionId.ControlSet, { alias: 'Gain 1', value: Number.NaN })).rejects.toThrow(
			'is not a number',
		)
		await expect(runAction(defs, ActionId.ControlSet, { alias: 'Gain 1', value: '3' })).rejects.toThrow(
			'is not a number',
		)
		await expect(runAction(defs, ActionId.ControlSetInc, { alias: 'Gain 1', value: 0, pos: '++' })).rejects.toThrow(
			'is not more than 0',
		)
		await expect(runAction(defs, ActionId.ControlSetInc, { alias: 'Gain 1', value: 1, pos: '+' })).rejects.toThrow(
			'Direction + is not valid',
		)
		await expect(runAction(defs, ActionId.ControlPositionSet, { alias: 'Gain 1', value: 1.5 })).rejects.toThrow(
			'not between 0 and 1',
		)
		await expect(runAction(defs, ActionId.ControlPositionInvert, { alias: 'Gain 1', value: -0.1 })).rejects.toThrow(
			'not between 0 and 1',
		)
		await expect(
			runAction(defs, ActionId.ChangeGroupClear, { changeGroup: { group: 'x' } as unknown as string }),
		).rejects.toThrow('is not text')
		expect(fake.sendCommand).not.toHaveBeenCalled()
	})
})

describe('subscriptions', () => {
	it('query a control and add it to the default change group, for each action using one', async () => {
		for (const [version, commands] of [
			['v2', ['cg "Gain 1"', 'cgca "Gain 1"']],
			['v1', ['controlGet "Gain 1"', 'changeGroupAddControl "Gain 1"']],
		] as const) {
			const fake = fakeInstance(version)
			const defs = actionDefinitions(fake)
			await subscribeAction(defs, ActionId.ControlSet, { alias: 'Gain 1', value: 1 })
			expect(fake.queueCommands).toHaveBeenCalledExactlyOnceWith(...commands)
		}
	})

	it('rerun when the alias changes, and only then', () => {
		const defs = actionDefinitions(fakeInstance('v2'))
		for (const id of [ActionId.ControlGet, ActionId.ControlSet, ...V2_ONLY, ActionId.ControlSetString]) {
			expect(definition(defs, id).optionsToMonitorForSubscribe, id).toEqual(['alias'])
		}
		for (const id of [ActionId.ChangeGroupControlAdd, ActionId.ChangeGroupControlRemove, ActionId.ChangeGroupClear]) {
			expect(definition(defs, id).optionsToMonitorForSubscribe, id).toEqual(['changeGroup'])
		}
	})

	it('skip an action with no alias yet, and warn of one the DSP could not take', async () => {
		const fake = fakeInstance('v2')
		const defs = actionDefinitions(fake)
		await subscribeAction(defs, ActionId.ControlGet, { alias: '' })
		expect(fake.log).not.toHaveBeenCalled()
		await subscribeAction(defs, ActionId.ControlGet, { alias: 'a"b' })
		expect(fake.log).toHaveBeenCalledWith('warn', expect.stringContaining('must not contain'))
		expect(fake.queueCommands).not.toHaveBeenCalled()
	})

	it('poll the change group a change group action uses', async () => {
		const fake = fakeInstance('v2')
		const defs = actionDefinitions(fake)
		await subscribeAction(defs, ActionId.ChangeGroupControlRemove, { alias: 'Gain 1', changeGroup: 'Mine' })
		await subscribeAction(defs, ActionId.ChangeGroupClear, { changeGroup: '' })
		expect(fake.queueCommands.mock.calls).toEqual([['cgg "Mine"'], ['cgg']])
	})
})
