export const DEFAULT_PORT = 1632
export const EOM = '\r\n'
export const PARAM_SEP = ' '
/** Encloses an alias, change group or string parameter. None of them can contain one */
export const QUOTE = '"'
/** Begins a line the DSP flags as an alert, such as an error reply */
export const ALERT = '\x07'
/** Aliases with this in them are RATCv2 RAW mode paths, of which a project can have very many */
export const RAW_ALIAS_IDENT = '//devices/'
/** The DSP ends a RATCv2 session that has been idle this many seconds */
export const KEEP_ALIVE_SECONDS = 30
/** How often a RATCv2 DSP is asked to report what changed in the default change group, in seconds */
export const CHANGE_GROUP_SCHEDULE_SECONDS = 1

export type RatcVersion = 'v1' | 'v2'

export const cmd = {
	v1: {
		help: 'help',
		statusGet: 'statusGet',
		controlGet: 'controlGet',
		controlSet: 'controlSet',
		controlList: 'controlList',
		changeGroupAddControl: 'changeGroupAddControl',
		changeGroupRemoveControl: 'changeGroupRemoveControl',
		changeGroupClear: 'changeGroupClear',
		changeGroupGet: 'changeGroupGet',
	},
	v2: {
		help: 'h', // display help list
		logIn: 'li', // logIn name password : log in with a password
		statusGet: 'sg', // statusGet : report status
		keepAlive: 'ka', // keepAlive seconds : disconnect if no activity in n seconds
		quietModeEnable: 'qme', // quietModeEnable : suppress responses from non-query commands
		quietModeDisable: 'qmd', // quietModeDisable : allow responses from all commands
		controlList: 'cl', // controlList : get the list of available Controls
		controlGet: 'cg', // controlGet control : get a Controls value
		controlSet: 'cs', // controlSet control value : set a Controls value
		controlPositionSet: 'cps', // controlPositionSet control value : set a Controls position
		changeGroupControlAdd: 'cgca', // changeGroupControlAdd [group] control : add a Control to a Change Group
		changeGroupControlRemove: 'cgcr', // changeGroupControlRemove [group] control : remove a Control from a Change Group
		changeGroupGet: 'cgg', // changeGroupGet [group] : get changed values from a Change Group
		changeGroupClear: 'cgc', // changeGroupClear [group] : clear a Change Group (of changed values)
		changeGroupSchedule: 'cgs', // changeGroupSchedule [group] seconds : schedule recurring Change Group gets
	},
	/** The long forms of the RATCv2 commands, which the DSP may echo back */
	v2Long: {
		help: 'help',
		logIn: 'logIn',
		statusGet: 'statusGet',
		keepAlive: 'keepAlive',
		quietModeEnable: 'quietModeEnable',
		quietModeDisable: 'quietModeDisable',
		controlList: 'controlList',
		controlGet: 'controlGet',
		controlSet: 'controlSet',
		controlPositionSet: 'controlPositionSet',
		changeGroupControlAdd: 'changeGroupControlAdd',
		changeGroupControlRemove: 'changeGroupControlRemove',
		changeGroupGet: 'changeGroupGet',
		changeGroupClear: 'changeGroupClear',
		changeGroupSchedule: 'changeGroupSchedule',
	},
} as const

export const resp = {
	v1: {
		overflow: 'Overflow',
		statusIs: 'statusIs',
		valueIs: 'valueIs',
		badArgumentCount: 'BadArgumentCount',
		unlistedGroup: 'UnlistedGroup',
		addedToChangeGroup: 'addedToChangeGroup',
		removedFromChangeGroup: 'removedFromChangeGroup',
		invalidChangeGroup: 'InvalidChangeGroup',
		clearedChangeGroup: 'clearedChangeGroup',
		numberOfChanges: 'numberOfChanges',
		notRunning: 'NotRunning',
		badCommand: 'BadCommand',
		username: 'Name:',
		password: 'Password:',
		loginFailed: 'LoginFailed',
		ratcVersion: 'RATCVersion',
		welcome: 'Welcome',
		startControlGroupList: '{',
		aliasControlGroupList: 'group:',
		endControlGroupList: '}',
	},
	v2: {
		statusIs: 'statusIs',
		valueIs: 'valueIs',
		loggedIn: 'loggedIn',
		keepAlive: 'keepAlive',
		quietModeEnabled: 'quietModeEnabled',
		quietModeDisabled: 'quietModeDisabled',
		changeGroupControlAdded: 'changeGroupControlAdded',
		changeGroupControlRemoved: 'changeGroupControlRemoved',
		changeGroupCleared: 'changeGroupCleared',
		changeGroupChanges: 'changeGroupChanges',
		changeGroupSchedule: 'changeGroupSchedule',
		badCommand: 'badCommand',
		badArgumentCount: 'badArgumentCount',
		overflow: 'overflow',
		unlistedControl: 'unlistedControl',
		invalidChangeGroup: 'invalidChangeGroup',
		commandFailed: 'commandFailed',
		commandUnsupported: 'commandUnsupported',
		notLoggedIn: 'notLoggedIn',
		loginFailed: 'loginFailed',
	},
} as const
