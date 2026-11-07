import type { CompanionVariableDefinitions, CompanionVariableValues } from '@companion-module/base'
import type PeavyRatcInstance from './main.js'
import { RAW_ALIAS_IDENT } from './consts.js'
import { sanitiseVariableId } from './utils.js'

/** The variables are named after the aliases the DSP lists, so their ids are only known at runtime */
export type VariablesSchema = CompanionVariableValues

/** A RATCv2 RAW mode alias. Variables are not defined for these, as a project can have very many */
export function isRawAlias(alias: string): boolean {
	return alias.includes(RAW_ALIAS_IDENT)
}

/** The ids of an alias's variables. Position is RATCv2 only */
export function aliasVariableIds(alias: string): { name: string; value: string; position: string } {
	const id = sanitiseVariableId(alias)
	return {
		name: `controlAliasName_${id}`,
		value: `controlAliasValue_${id}`,
		position: `controlAliasPosition_${id}`,
	}
}

export function UpdateVariableDefinitions(self: PeavyRatcInstance): void {
	const variables: CompanionVariableDefinitions<VariablesSchema> = {}
	for (const alias of self.controlAliases) {
		if (isRawAlias(alias)) continue
		const ids = aliasVariableIds(alias)
		variables[ids.name] = { name: `Control Alias Name ${alias}` }
		variables[ids.value] = { name: `Control Alias Value ${alias}` }
		if (self.version === 'v2') variables[ids.position] = { name: `Control Alias Position ${alias}` }
	}
	self.setVariableDefinitions(variables)
}

/** Each defined alias's name variable, holding the alias as the DSP names it */
export function aliasNameValues(aliases: Iterable<string>): VariablesSchema {
	const values: VariablesSchema = {}
	for (const alias of aliases) {
		if (!isRawAlias(alias)) values[aliasVariableIds(alias).name] = alias
	}
	return values
}
