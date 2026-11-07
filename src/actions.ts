import type {
	CompanionActionDefinitions,
	CompanionInputFieldDropdown,
	CompanionInputFieldNumber,
	CompanionInputFieldTextInput,
	DropdownChoice,
} from '@companion-module/base'
import type PeavyRatcInstance from './main.js'
import {
	DIRECTIONS,
	changeGroupClear,
	changeGroupControlAdd,
	changeGroupControlRemove,
	changeGroupGet,
	controlGet,
	controlPositionSet,
	controlSet,
	controlSetString,
	controlStep,
	statusGet,
	type Direction,
} from './protocol.js'
import { errorMessage } from './utils.js'

/**
 * Action ids. The values are the ids saved against every button using the action, so they must never change. They
 * predate this enum, which is why they are camelCase.
 */
export enum ActionId {
	StatusGet = 'statusGet',
	ControlGet = 'controlGet',
	ControlSet = 'controlSet',
	ControlSetInc = 'controlSetInc',
	ControlSetString = 'controlSetString',
	ControlPositionSet = 'controlPositionSet',
	ControlPositionInvert = 'controlPositionInvert',
	ChangeGroupControlAdd = 'changeGroupControlAdd',
	ChangeGroupControlRemove = 'changeGroupControlRemove',
	ChangeGroupClear = 'changeGroupClear',
}

/** RATCv1 has a single change group, so its change group actions leave the group out */
type ChangeGroupOptions = { changeGroup?: string }

export type ActionSchema = {
	[ActionId.StatusGet]: { options: Record<string, never> }
	[ActionId.ControlGet]: { options: { alias: string } }
	[ActionId.ControlSet]: { options: { alias: string; value: number } }
	[ActionId.ControlSetInc]: { options: { alias: string; value: number; pos: Direction } }
	[ActionId.ControlSetString]: { options: { alias: string; string: string } }
	[ActionId.ControlPositionSet]: { options: { alias: string; value: number } }
	[ActionId.ControlPositionInvert]: { options: { alias: string; value: number } }
	[ActionId.ChangeGroupControlAdd]: { options: { alias: string } & ChangeGroupOptions }
	[ActionId.ChangeGroupControlRemove]: { options: { alias: string } & ChangeGroupOptions }
	[ActionId.ChangeGroupClear]: { options: ChangeGroupOptions }
}

/** The widest a control value can be set to. Wide, so as not to get in the way of any control's real range */
export const VALUE_LIMIT = 1_000_000

function aliasOption(choices: DropdownChoice<string>[]): CompanionInputFieldDropdown<'alias', string> {
	return {
		id: 'alias',
		type: 'dropdown',
		label: 'Control Alias',
		// The choices are the aliases the DSP lists, so are not known here
		default: '',
		choices,
		allowCustom: true,
		minChoicesForSearch: 20,
		tooltip: 'Alias must not contain "',
	}
}

function valueOption(): CompanionInputFieldNumber<'value'> {
	return {
		id: 'value',
		type: 'number',
		label: 'Value',
		default: 1,
		min: -VALUE_LIMIT,
		max: VALUE_LIMIT,
		step: 0.001,
		tooltip: 'Sent to 3 decimal places',
	}
}

function stepOption(): CompanionInputFieldNumber<'value'> {
	return { ...valueOption(), min: 0, tooltip: 'Must be more than 0. Sent to 3 decimal places' }
}

function positionOption(): CompanionInputFieldNumber<'value'> {
	return {
		id: 'value',
		type: 'number',
		label: 'Position',
		default: 1,
		min: 0,
		max: 1,
		step: 0.001,
		tooltip: 'From 0 to 1. Sent to 3 decimal places',
	}
}

function changeGroupOption(): CompanionInputFieldTextInput<'changeGroup'> {
	return {
		id: 'changeGroup',
		type: 'textinput',
		label: 'Change Group',
		default: '',
		useVariables: true,
		tooltip: 'Leave empty for the default change group. Must not contain "',
	}
}

/**
 * A control alias option. A custom value can come through as a number when it is an expression
 * @throws if there is none
 */
export function aliasValue(value: unknown): string {
	const alias = typeof value === 'number' ? String(value) : value
	if (typeof alias !== 'string' || alias === '') throw new Error('No control alias')
	return alias
}

/**
 * A text option, empty if unset. An expression can give a number or boolean
 * @throws if it is anything else
 */
function textValue(value: unknown): string {
	if (value === undefined || value === null) return ''
	if (typeof value === 'string') return value
	if (typeof value === 'number' || typeof value === 'boolean') return String(value)
	throw new Error(`${JSON.stringify(value)} is not text`)
}

/** @throws if the value is not a finite number */
function numberValue(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} ${String(value)} is not a number`)
	return value
}

/** @throws if the value is not a position, from 0 to 1 */
function positionValue(value: unknown): number {
	const position = numberValue(value, 'Position')
	if (position < 0 || position > 1) throw new Error(`Position ${position} is not between 0 and 1`)
	return position
}

/** @throws if the value is not one of the directions */
function directionValue(value: unknown): Direction {
	const direction = DIRECTIONS.find((d) => d.id === value)
	if (direction === undefined) throw new Error(`Direction ${String(value)} is not valid`)
	return direction.id
}

export function UpdateActions(self: PeavyRatcInstance): void {
	const version = self.version
	const choices: DropdownChoice<string>[] = self.controlAliases.map((alias) => ({ id: alias, label: alias }))

	/**
	 * Queries a control's value, and adds it to the default change group so its changes are reported. On every action
	 * placed using it, and again for each on logging in
	 */
	function watchControl(value: unknown): void {
		// A newly placed action has no alias yet
		if (value === undefined || value === '') return
		try {
			const alias = aliasValue(value)
			self.queueCommands(controlGet(version, alias), changeGroupControlAdd(version, alias))
		} catch (err) {
			self.log('warn', `Not watching control: ${errorMessage(err)}`)
		}
	}

	function pollChangeGroup(value: unknown): void {
		try {
			self.queueCommands(changeGroupGet(version, textValue(value)))
		} catch (err) {
			self.log('warn', `Not polling change group: ${errorMessage(err)}`)
		}
	}

	const v2 = version === 'v2'

	const actions: CompanionActionDefinitions<ActionSchema> = {
		[ActionId.StatusGet]: {
			name: 'Status Get',
			description: 'Returns the DSP Status and project name',
			options: [],
			callback: async (_action, context) => {
				await self.sendCommand(statusGet(version), context.signal)
			},
		},
		[ActionId.ControlGet]: {
			name: 'Control Get',
			description: 'Get the value of a control',
			options: [aliasOption(choices)],
			callback: async ({ options }, context) => {
				await self.sendCommand(controlGet(version, aliasValue(options.alias)), context.signal)
			},
			optionsToMonitorForSubscribe: ['alias'],
			subscribe: ({ options }) => watchControl(options.alias),
		},
		[ActionId.ControlSet]: {
			name: 'Control Set',
			description: 'Set the value of a control',
			options: [aliasOption(choices), valueOption()],
			callback: async ({ options }, context) => {
				const command = controlSet(version, aliasValue(options.alias), numberValue(options.value, 'Value'))
				await self.sendCommand(command, context.signal)
			},
			optionsToMonitorForSubscribe: ['alias'],
			subscribe: ({ options }) => watchControl(options.alias),
		},
		[ActionId.ControlSetInc]: v2
			? {
					name: 'Control Set - Increment',
					description: 'Increment the value of a control',
					options: [
						aliasOption(choices),
						stepOption(),
						{
							id: 'pos',
							type: 'dropdown',
							label: '+/-',
							default: DIRECTIONS[0].id,
							choices: [...DIRECTIONS],
						},
					],
					callback: async ({ options }, context) => {
						const step = numberValue(options.value, 'Value')
						if (step <= 0) throw new Error(`Value ${step} is not more than 0`)
						const command = controlStep(aliasValue(options.alias), step, directionValue(options.pos))
						await self.sendCommand(command, context.signal)
					},
					optionsToMonitorForSubscribe: ['alias'],
					subscribe: ({ options }) => watchControl(options.alias),
				}
			: undefined,
		[ActionId.ControlSetString]: {
			name: 'Control Set String',
			description: 'Set the value of a string control',
			options: [
				aliasOption(choices),
				{
					id: 'string',
					type: 'textinput',
					label: 'String',
					default: '',
					useVariables: true,
					tooltip: 'Must not contain "',
				},
			],
			callback: async ({ options }, context) => {
				const command = controlSetString(version, aliasValue(options.alias), textValue(options.string))
				await self.sendCommand(command, context.signal)
			},
			optionsToMonitorForSubscribe: ['alias'],
			subscribe: ({ options }) => watchControl(options.alias),
		},
		[ActionId.ControlPositionSet]: v2
			? {
					name: 'Control Position Set',
					description: 'Set the control position',
					options: [aliasOption(choices), positionOption()],
					callback: async ({ options }, context) => {
						const command = controlPositionSet(aliasValue(options.alias), positionValue(options.value))
						await self.sendCommand(command, context.signal)
					},
					optionsToMonitorForSubscribe: ['alias'],
					subscribe: ({ options }) => watchControl(options.alias),
				}
			: undefined,
		[ActionId.ControlPositionInvert]: v2
			? {
					name: 'Control Position Invert',
					description: 'Position will be set to 1 - value.',
					options: [
						aliasOption(choices),
						positionOption(),
						{
							id: 'info',
							type: 'static-text',
							label: 'Explanation',
							value:
								'Position will be set to 1 - Position. Enter the position variable of a button control to achieve a toggle action',
						},
					],
					callback: async ({ options }, context) => {
						const command = controlPositionSet(aliasValue(options.alias), 1 - positionValue(options.value))
						await self.sendCommand(command, context.signal)
					},
					optionsToMonitorForSubscribe: ['alias'],
					subscribe: ({ options }) => watchControl(options.alias),
				}
			: undefined,
		[ActionId.ChangeGroupControlAdd]: {
			name: 'Change Group Control Add',
			description: 'Add a control to a change group',
			options: v2 ? [aliasOption(choices), changeGroupOption()] : [aliasOption(choices)],
			callback: async ({ options }, context) => {
				const command = changeGroupControlAdd(version, aliasValue(options.alias), textValue(options.changeGroup))
				await self.sendCommand(command, context.signal)
			},
			optionsToMonitorForSubscribe: ['changeGroup'],
			subscribe: ({ options }) => pollChangeGroup(options.changeGroup),
		},
		[ActionId.ChangeGroupControlRemove]: {
			name: 'Change Group Control Remove',
			description: 'Remove a control from a change group',
			options: v2 ? [aliasOption(choices), changeGroupOption()] : [aliasOption(choices)],
			callback: async ({ options }, context) => {
				const command = changeGroupControlRemove(version, aliasValue(options.alias), textValue(options.changeGroup))
				await self.sendCommand(command, context.signal)
			},
			optionsToMonitorForSubscribe: ['changeGroup'],
			subscribe: ({ options }) => pollChangeGroup(options.changeGroup),
		},
		[ActionId.ChangeGroupClear]: {
			name: 'Change Group Clear',
			description: v2 ? 'To destroy a change group' : 'The Change Group is cleared of all Control Aliases',
			options: v2 ? [changeGroupOption()] : [],
			callback: async ({ options }, context) => {
				await self.sendCommand(changeGroupClear(version, textValue(options.changeGroup)), context.signal)
			},
			optionsToMonitorForSubscribe: ['changeGroup'],
			subscribe: ({ options }) => pollChangeGroup(options.changeGroup),
		},
	}
	self.setActionDefinitions(actions)
}
