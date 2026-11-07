import { vi } from 'vitest'
import type {
	CompanionActionCallbackContext,
	CompanionActionContext,
	CompanionActionDefinitions,
	CompanionActionEvent,
	CompanionActionInfo,
	CompanionOptionValues,
	SomeCompanionActionInputField,
} from '@companion-module/base'
import type PeavyRatcInstance from '../main.js'
import type { RatcVersion } from '../consts.js'
import { UpdateActions, type ActionId, type ActionSchema } from '../actions.js'

function createMocks() {
	return {
		sendCommand: vi.fn<PeavyRatcInstance['sendCommand']>(async () => {}),
		queueCommands: vi.fn<PeavyRatcInstance['queueCommands']>(),
		log: vi.fn<PeavyRatcInstance['log']>(),
		setActionDefinitions: vi.fn<(defs: CompanionActionDefinitions<ActionSchema>) => void>(),
	}
}

export type FakeInstance = { self: PeavyRatcInstance } & ReturnType<typeof createMocks>

/**
 * A plain object standing in for the instance, for the definitions to be built from. Everything that would reach
 * Companion or the DSP is a mock.
 */
export function fakeInstance(version: RatcVersion, controlAliases: string[] = []): FakeInstance {
	const mocks = createMocks()
	const self = { version, controlAliases, ...mocks } as unknown as PeavyRatcInstance
	return { self, ...mocks }
}

export function actionDefinitions(fake: FakeInstance): CompanionActionDefinitions<ActionSchema> {
	UpdateActions(fake.self)
	return fake.setActionDefinitions.mock.calls[0][0]
}

// The definitions' hooks are typed per action. These take any options, as the values Companion passes are not checked
type AnyCallback = (event: CompanionActionEvent, context: CompanionActionCallbackContext) => Promise<void> | void
type AnySubscribe = (event: CompanionActionInfo, context: CompanionActionContext) => Promise<void> | void

/** An action definition, with its options and hooks typed for any action */
export interface AnyActionDefinition {
	options: SomeCompanionActionInputField[]
	optionsToMonitorForSubscribe?: string[]
	callback: AnyCallback
	subscribe?: AnySubscribe
}

/** @throws if the action is not defined */
export function definition(defs: CompanionActionDefinitions<ActionSchema>, actionId: ActionId): AnyActionDefinition {
	const def = defs[actionId]
	if (!def) throw new Error(`${actionId} is not defined`)
	return def as unknown as AnyActionDefinition
}

/** Runs an action's callback as Companion would, with the option values already resolved */
export async function runAction(
	defs: CompanionActionDefinitions<ActionSchema>,
	actionId: ActionId,
	options: CompanionOptionValues = {},
	signal = new AbortController().signal,
): Promise<void> {
	const event: CompanionActionEvent = {
		id: `action-${actionId}`,
		controlId: 'bank-1',
		actionId,
		surfaceId: undefined,
		options,
	}
	await definition(defs, actionId).callback(event, { type: 'action', signal } as never)
}

/** Runs an action's subscribe hook as Companion would, with the option values already resolved */
export async function subscribeAction(
	defs: CompanionActionDefinitions<ActionSchema>,
	actionId: ActionId,
	options: CompanionOptionValues = {},
): Promise<void> {
	const subscribe = definition(defs, actionId).subscribe
	if (!subscribe) throw new Error(`${actionId} has no subscribe`)
	const event: CompanionActionInfo = { id: `action-${actionId}`, controlId: 'bank-1', actionId, options }
	await subscribe(event, { type: 'action' } as never)
}
