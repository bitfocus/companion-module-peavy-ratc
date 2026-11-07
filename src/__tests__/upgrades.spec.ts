import { describe, expect, it } from 'vitest'
import type {
	CompanionMigrationAction,
	CompanionStaticUpgradeProps,
	CompanionUpgradeContext,
} from '@companion-module/base'
import {
	UpgradeScripts,
	numericActionOptionsApi2,
	textActionOptionsApi2,
	variableDropdownOptionsApi2,
} from '../upgrades.js'
import { ActionId } from '../actions.js'
import type { ModuleConfig, ModuleSecrets } from '../config.js'
import { actionDefinitions, definition, fakeInstance } from './fixtures.js'

/**
 * Upgrade scripts are order-sensitive: a stored upgrade index records how far a configuration has been migrated, so
 * scripts may only ever be appended. Pin the indexes rather than taking the last entry, so appending a script can't
 * silently retarget this suite.
 */
const API2_SCRIPT_INDEX = 0
const EXPECTED_SCRIPT_COUNT = 1

// Options reach upgrade scripts already wrapped as ExpressionOrValue — Companion does that before running them
const v = (value: unknown) => ({ isExpression: false, value })
const expr = (value: string) => ({ isExpression: true, value })

function action(actionId: string, options: Record<string, unknown>): CompanionMigrationAction {
	return {
		id: `action-${actionId}`,
		controlId: 'bank-1',
		actionId,
		options: options as CompanionMigrationAction['options'],
	}
}

/** A config as module 1.x saved it */
const config1x = (overrides: Record<string, unknown> = {}) =>
	({
		host: '10.0.0.1',
		port: '1632',
		v2: true,
		username: 'defaultuser',
		password: 'password',
		...overrides,
	}) as unknown as ModuleConfig

function run(
	index: number,
	actions: CompanionMigrationAction[],
	savedConfig: ModuleConfig | null = null,
	savedSecrets: ModuleSecrets | null = null,
) {
	return UpgradeScripts[index]({} as CompanionUpgradeContext<ModuleConfig>, {
		config: savedConfig,
		secrets: savedSecrets,
		actions,
		feedbacks: [],
	} satisfies CompanionStaticUpgradeProps<ModuleConfig, ModuleSecrets>)
}

it('the scripts sit at the indexes this suite targets', () => {
	// Appending a script is fine — bump EXPECTED_SCRIPT_COUNT. Never insert, reorder or remove one.
	expect(UpgradeScripts).toHaveLength(EXPECTED_SCRIPT_COUNT)
})

describe('API 2.x upgrade script: config', () => {
	it('makes the port a number, and moves the password to the secrets', () => {
		const result = run(API2_SCRIPT_INDEX, [], config1x())
		expect(result.updatedConfig).toEqual({ host: '10.0.0.1', port: 1632, v2: true, username: 'defaultuser' })
		expect(result.updatedSecrets).toEqual({ password: 'password' })
	})

	it('gives a port that is no port the default', () => {
		expect(run(API2_SCRIPT_INDEX, [], config1x({ port: 'abc' })).updatedConfig?.port).toBe(1632)
		expect(run(API2_SCRIPT_INDEX, [], config1x({ port: '70000' })).updatedConfig?.port).toBe(1632)
		expect(run(API2_SCRIPT_INDEX, [], config1x({ port: undefined })).updatedConfig?.port).toBe(1632)
		expect(run(API2_SCRIPT_INDEX, [], config1x({ port: ' 1700 ' })).updatedConfig?.port).toBe(1700)
	})

	it('leaves a config already upgraded as it is', () => {
		const config = { host: '10.0.0.1', port: 1632, v2: false, username: 'me' }
		const result = run(API2_SCRIPT_INDEX, [], config, { password: 'secret' })
		expect(result.updatedConfig).toBeNull()
		expect(result.updatedSecrets).toBeNull()
	})

	it('keeps a password already in the secrets, as it can only have been entered since', () => {
		const result = run(API2_SCRIPT_INDEX, [], config1x(), { password: 'newer' })
		expect(result.updatedConfig).not.toHaveProperty('password')
		expect(result.updatedSecrets).toBeNull()
	})

	it('moves a password that is not text as an empty one', () => {
		expect(run(API2_SCRIPT_INDEX, [], config1x({ password: 5 })).updatedSecrets).toEqual({ password: '' })
	})
})

describe('API 2.x upgrade script: actions', () => {
	it('makes numbers of the numeric options, and expressions of their variables', () => {
		const actions = [
			action(ActionId.ControlSet, { alias: v('Gain 1'), value: v('-3.5') }),
			action(ActionId.ControlSetInc, { alias: v('Gain 1'), value: v('1'), pos: v('++') }),
			action(ActionId.ControlPositionSet, { alias: v('Gain 1'), value: v('$(internal:x)') }),
			action(ActionId.ControlPositionInvert, { alias: v('Mute 1'), value: v('$(peavy:a)$(peavy:b)') }),
		]
		const result = run(API2_SCRIPT_INDEX, actions)
		expect(result.updatedActions).toEqual(actions)
		expect(actions.map((a) => a.options.value)).toEqual([
			v(-3.5),
			v(1),
			expr('$(internal:x)'),
			expr('parseVariables("$(peavy:a)$(peavy:b)")'),
		])
	})

	it('makes an expression of an alias holding variables, and leaves any other alias as text', () => {
		const actions = [
			action(ActionId.ControlGet, { alias: v('$(local:alias)') }),
			action(ActionId.ChangeGroupControlRemove, { alias: v('Gain $(local:n)'), changeGroup: v('') }),
			action(ActionId.ControlGet, { alias: v('12') }),
			action(ActionId.ControlGet, { alias: v('Gain 1') }),
		]
		const result = run(API2_SCRIPT_INDEX, actions)
		expect(result.updatedActions).toEqual(actions.slice(0, 2))
		expect(actions.map((a) => a.options.alias)).toEqual([
			expr('$(local:alias)'),
			expr('parseVariables("Gain $(local:n)")'),
			v('12'),
			v('Gain 1'),
		])
	})

	it('makes text of a string option saved with the old number default', () => {
		const actions = [
			action(ActionId.ControlSetString, { alias: v('Label'), string: v(1) }),
			action(ActionId.ControlSetString, { alias: v('Label'), string: v('hi') }),
		]
		const result = run(API2_SCRIPT_INDEX, actions)
		expect(result.updatedActions).toEqual(actions.slice(0, 1))
		expect(actions.map((a) => a.options.string)).toEqual([v('1'), v('hi')])
	})

	it('reports only the actions it changed', () => {
		const actions = [
			action(ActionId.ControlSet, { alias: v('Gain 1'), value: v(2) }),
			action(ActionId.ControlPositionSet, { alias: v('Gain 1'), value: expr('$(a:b)') }),
			action(ActionId.StatusGet, {}),
			action('someOtherAction', { value: v('3') }),
		]
		expect(run(API2_SCRIPT_INDEX, actions).updatedActions).toEqual([])
	})

	it('lists options that are what the definitions now make them', () => {
		const defs = actionDefinitions(fakeInstance('v2'))
		const field = (id: ActionId, key: string) => definition(defs, id).options.find((o) => o.id === key)
		for (const [id, keys] of Object.entries(numericActionOptionsApi2)) {
			for (const key of keys) expect(field(id as ActionId, key), `${id}.${key}`).toMatchObject({ type: 'number' })
		}
		for (const [id, keys] of Object.entries(variableDropdownOptionsApi2)) {
			for (const key of keys) {
				expect(field(id as ActionId, key), `${id}.${key}`).toMatchObject({ type: 'dropdown', allowCustom: true })
			}
		}
		for (const [id, keys] of Object.entries(textActionOptionsApi2)) {
			for (const key of keys) expect(field(id as ActionId, key), `${id}.${key}`).toMatchObject({ type: 'textinput' })
		}
	})
})
