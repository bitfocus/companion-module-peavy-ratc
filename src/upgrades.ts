import {
	FixupNumericOrVariablesValueToExpressions,
	type CompanionMigrationAction,
	type CompanionStaticUpgradeProps,
	type CompanionStaticUpgradeResult,
	type CompanionStaticUpgradeScript,
	type CompanionUpgradeContext,
	type ExpressionOrValue,
	type JsonValue,
} from '@companion-module/base'
import { validPort, type ModuleConfig, type ModuleSecrets } from './config.js'
import { DEFAULT_PORT } from './consts.js'
import { ActionId } from './actions.js'

type OptionValue = ExpressionOrValue<JsonValue | undefined> | undefined

/**
 * Options that were text inputs parsed as numbers before the API 2.x migration, so could hold a number typed as a
 * string, or variables. They are number fields since. Frozen history for UpgradeScripts[0]: do not edit to track later
 * changes, add a new script instead.
 */
export const numericActionOptionsApi2: Partial<Record<ActionId, string[]>> = {
	[ActionId.ControlSet]: ['value'],
	[ActionId.ControlSetInc]: ['value'],
	[ActionId.ControlPositionSet]: ['value'],
	[ActionId.ControlPositionInvert]: ['value'],
}

/**
 * Before API 2.x the module parsed the variables in the Control Alias dropdown, whose custom values could hold them.
 * Companion parses a text input's variables itself, but not a dropdown's. Frozen history for UpgradeScripts[0], as
 * {@link numericActionOptionsApi2} is.
 */
export const variableDropdownOptionsApi2: Partial<Record<ActionId, string[]>> = {
	[ActionId.ControlGet]: ['alias'],
	[ActionId.ControlSet]: ['alias'],
	[ActionId.ControlSetInc]: ['alias'],
	[ActionId.ControlSetString]: ['alias'],
	[ActionId.ControlPositionSet]: ['alias'],
	[ActionId.ControlPositionInvert]: ['alias'],
	[ActionId.ChangeGroupControlAdd]: ['alias'],
	[ActionId.ChangeGroupControlRemove]: ['alias'],
}

/**
 * Text inputs whose default was a number before API 2.x, so a button never edited holds one. Companion takes a text
 * input's value as text since. Frozen history for UpgradeScripts[0], as {@link numericActionOptionsApi2} is.
 */
export const textActionOptionsApi2: Partial<Record<ActionId, string[]>> = {
	[ActionId.ControlSetString]: ['string'],
}

/** Whether the helper changed a value. It always hands back a fresh object, so this compares contents, not identity */
function isChanged(current: OptionValue, fixed: OptionValue): boolean {
	return fixed?.isExpression !== current?.isExpression || fixed?.value !== current?.value
}

/** Converts the listed options in place. Returns whether anything changed */
function fixupNumericOptions(action: CompanionMigrationAction, keys?: string[]): boolean {
	if (!keys) return false
	let changed = false
	for (const key of keys) {
		const current = action.options[key]
		const fixed = FixupNumericOrVariablesValueToExpressions(current)
		if (isChanged(current, fixed)) {
			action.options[key] = fixed
			changed = true
		}
	}
	return changed
}

/**
 * Makes an expression of each listed option holding variables, which gives the text it did when the module parsed
 * them: a lone variable as it is, anything else in parseVariables(). Other text is left as it is, so an alias that
 * looks like a number stays text. Returns whether anything changed
 */
function fixupVariableOptions(action: CompanionMigrationAction, keys?: string[]): boolean {
	if (!keys) return false
	let changed = false
	for (const key of keys) {
		const current = action.options[key]
		if (current === undefined || current.isExpression || typeof current.value !== 'string') continue
		if (!current.value.includes('$(')) continue
		// Text with a variable in it never reads as a number, so the helper takes it as text
		const fixed = FixupNumericOrVariablesValueToExpressions(current)
		if (isChanged(current, fixed)) {
			action.options[key] = fixed
			changed = true
		}
	}
	return changed
}

/** Makes text of each listed option holding a number or boolean. Returns whether anything changed */
function fixupTextOptions(action: CompanionMigrationAction, keys?: string[]): boolean {
	if (!keys) return false
	let changed = false
	for (const key of keys) {
		const current = action.options[key]
		if (current === undefined || current.isExpression) continue
		if (typeof current.value !== 'number' && typeof current.value !== 'boolean') continue
		action.options[key] = { isExpression: false, value: String(current.value) }
		changed = true
	}
	return changed
}

/** A config as saved before UpgradeScripts[0], with the port possibly text and the password still in it */
type ConfigApi1 = Omit<ModuleConfig, 'port'> & { port?: unknown; password?: unknown }

/** The port was a text input before API 2.x, so a saved config holds text, or the number default if never edited */
function numericPort(port: unknown): number {
	if (typeof port === 'string' && /^\d+$/.test(port.trim())) return validPort(Number(port.trim())) ?? DEFAULT_PORT
	return validPort(port) ?? DEFAULT_PORT
}

export const UpgradeScripts: CompanionStaticUpgradeScript<ModuleConfig, ModuleSecrets>[] = [
	/*
	 * Place your upgrade scripts here
	 * Remember that once it has been added it cannot be removed!
	 */

	// 0: API 2.x — numeric text inputs became number fields, and the port a number field. "3" becomes 3, "$(local:x)"
	// becomes an expression, anything else is wrapped in parseVariables(). An alias holding variables becomes an
	// expression the same way. The password moved from the config to the secrets, which Companion does not report to the
	// web UI.
	function api2(
		_context: CompanionUpgradeContext<ModuleConfig>,
		props: CompanionStaticUpgradeProps<ModuleConfig, ModuleSecrets>,
	): CompanionStaticUpgradeResult<ModuleConfig, ModuleSecrets> {
		const result: CompanionStaticUpgradeResult<ModuleConfig, ModuleSecrets> = {
			updatedConfig: null,
			updatedSecrets: null,
			updatedActions: props.actions.filter((action) => {
				const id = action.actionId as ActionId
				const numeric = fixupNumericOptions(action, numericActionOptionsApi2[id])
				const variables = fixupVariableOptions(action, variableDropdownOptionsApi2[id])
				const text = fixupTextOptions(action, textActionOptionsApi2[id])
				return numeric || variables || text
			}),
			updatedFeedbacks: [],
		}
		if (props.config === null) return result
		const { password, ...config } = props.config as ConfigApi1
		const hadPassword = 'password' in props.config
		const port = numericPort(config.port)
		if (hadPassword || port !== config.port) result.updatedConfig = { ...config, port }
		// A password already in the secrets can only have been entered since, so it is the one to keep
		if (hadPassword && typeof props.secrets?.password !== 'string') {
			result.updatedSecrets = { ...props.secrets, password: typeof password === 'string' ? password : '' }
		}
		return result
	},
]
