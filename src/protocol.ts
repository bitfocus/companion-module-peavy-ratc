import type { DropdownChoice } from '@companion-module/base'
import { CHANGE_GROUP_SCHEDULE_SECONDS, KEEP_ALIVE_SECONDS, PARAM_SEP, QUOTE, cmd, type RatcVersion } from './consts.js'

/** A relative control change: up or down by a step */
export const DIRECTIONS = [
	{ id: '++', label: 'Positive' },
	{ id: '--', label: 'Negative' },
] as const satisfies readonly DropdownChoice<string>[]
export type Direction = (typeof DIRECTIONS)[number]['id']

const join = (...parts: string[]): string => parts.join(PARAM_SEP)

/**
 * Encloses a parameter in quotes
 * @param what names the parameter in the error
 * @throws if the text holds a quote, which would end the parameter early
 */
export function quote(text: string, what = 'Alias'): string {
	if (text.includes(QUOTE)) throw new Error(`${what} must not contain ${QUOTE}: ${text}`)
	return QUOTE + text + QUOTE
}

/** RATCv2 names a change group as the first parameter, and an empty one means the default group */
function groupParam(group: string | undefined): string[] {
	return group ? [quote(group, 'Change group')] : []
}

export function statusGet(version: RatcVersion): string {
	return cmd[version].statusGet
}

export function controlList(version: RatcVersion): string {
	return cmd[version].controlList
}

export function controlGet(version: RatcVersion, alias: string): string {
	return join(cmd[version].controlGet, quote(alias))
}

/** The DSP takes values to 3 decimal places */
export function controlSet(version: RatcVersion, alias: string, value: number): string {
	return join(cmd[version].controlSet, quote(alias), value.toFixed(3))
}

/** RATCv2 only: changes a control by a step, rather than setting it */
export function controlStep(alias: string, step: number, direction: Direction): string {
	return join(cmd.v2.controlSet, quote(alias), direction + step.toFixed(3))
}

export function controlSetString(version: RatcVersion, alias: string, text: string): string {
	return join(cmd[version].controlSet, quote(alias), quote(text, 'String'))
}

/** RATCv2 only. A position runs from 0 to 1 */
export function controlPositionSet(alias: string, position: number): string {
	return join(cmd.v2.controlPositionSet, quote(alias), position.toFixed(3))
}

/** @param group RATCv2 only. Empty or undefined for the default group */
export function changeGroupControlAdd(version: RatcVersion, alias: string, group?: string): string {
	if (version === 'v1') return join(cmd.v1.changeGroupAddControl, quote(alias))
	return join(cmd.v2.changeGroupControlAdd, ...groupParam(group), quote(alias))
}

/** @param group RATCv2 only. Empty or undefined for the default group */
export function changeGroupControlRemove(version: RatcVersion, alias: string, group?: string): string {
	if (version === 'v1') return join(cmd.v1.changeGroupRemoveControl, quote(alias))
	return join(cmd.v2.changeGroupControlRemove, ...groupParam(group), quote(alias))
}

/** @param group RATCv2 only. Empty or undefined for the default group */
export function changeGroupGet(version: RatcVersion, group?: string): string {
	if (version === 'v1') return cmd.v1.changeGroupGet
	return join(cmd.v2.changeGroupGet, ...groupParam(group))
}

/** @param group RATCv2 only. Empty or undefined for the default group */
export function changeGroupClear(version: RatcVersion, group?: string): string {
	if (version === 'v1') return cmd.v1.changeGroupClear
	return join(cmd.v2.changeGroupClear, ...groupParam(group))
}

/**
 * The lines that log in, sent as soon as the connection opens. RATCv1 takes the username and password a line each,
 * RATCv2 a logIn command, which leaves out what is empty.
 */
export function loginLines(version: RatcVersion, username: string, password: string): string[] {
	if (version === 'v1') return [username, password]
	if (username === '') return [cmd.v2.logIn]
	if (password === '') return [join(cmd.v2.logIn, username)]
	return [join(cmd.v2.logIn, username, password)]
}

/** Sent on logging in: the status, the control list, and for RATCv2 the session settings this module relies on */
export function onLoginCommands(version: RatcVersion): string[] {
	if (version === 'v1') return [cmd.v1.statusGet, cmd.v1.controlList]
	return [
		cmd.v2.statusGet,
		join(cmd.v2.keepAlive, String(KEEP_ALIVE_SECONDS)),
		cmd.v2.quietModeDisable,
		cmd.v2.controlList,
		join(cmd.v2.changeGroupSchedule, String(CHANGE_GROUP_SCHEDULE_SECONDS)),
	]
}
