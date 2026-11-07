import type { SomeCompanionConfigField } from '@companion-module/base'
import { DEFAULT_PORT, type RatcVersion } from './consts.js'

export const DEFAULT_USERNAME = 'defaultuser'
export const DEFAULT_PASSWORD = 'password'

export type ModuleConfig = {
	host: string
	port: number
	/** RATCv2 when true, RATCv1 when false */
	v2: boolean
	username: string
}

/**
 * Kept out of the config, which Companion reports in full to the web UI. The password was in the config until
 * UpgradeScripts[0] moved it here.
 */
export type ModuleSecrets = {
	password: string
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'textinput',
			id: 'host',
			label: 'Host',
			width: 12,
			minLength: 1,
			default: '',
		},
		{
			type: 'number',
			id: 'port',
			label: 'Port',
			width: 6,
			min: 1,
			max: 65535,
			default: DEFAULT_PORT,
			tooltip: 'Port is not configurable on unit, only change in advanced configurations',
		},
		{
			type: 'checkbox',
			id: 'v2',
			label: 'Use V2',
			width: 6,
			default: true,
			tooltip: 'Turn off to use RATCv1',
		},
		{
			type: 'textinput',
			id: 'username',
			label: 'Username',
			width: 6,
			default: DEFAULT_USERNAME,
		},
		{
			type: 'secret-text',
			id: 'password',
			label: 'Password',
			width: 6,
			default: DEFAULT_PASSWORD,
		},
	]
}

/** The port, or undefined if it is not one TCP can use. A saved config isn't checked against its field's min and max */
export function validPort(port: unknown): number | undefined {
	return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined
}

export function ratcVersion(config: ModuleConfig): RatcVersion {
	return config.v2 ? 'v2' : 'v1'
}

/** The username, or empty for one that is not a string */
export function loginUsername(config: ModuleConfig): string {
	const username: unknown = config.username
	return typeof username === 'string' ? username : ''
}

/**
 * The password to log in with. A saved secret isn't checked against its field, so anything but a string is taken as no
 * password.
 */
export function loginPassword(secrets: ModuleSecrets | undefined): string {
	const password: unknown = secrets?.password
	return typeof password === 'string' ? password : ''
}
