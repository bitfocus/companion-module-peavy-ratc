const { InstanceBase, runEntrypoint, InstanceStatus } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades.js')
const UpdateActions = require('./actions.js')
const UpdateFeedbacks = require('./feedbacks.js')
const UpdateVariableDefinitions = require('./variables.js')
const config = require('./config.js')
const tcp = require('./tcp.js')
const processCmd = require('./processcmd.js')

class PEAVY_RATC extends InstanceBase {
	constructor(internal) {
		super(internal)
		Object.assign(this, { ...config, ...tcp, ...processCmd })
		this.instanceOptions.disableVariableValidation = true
		this.cmdQueue = []
		this.varList = []
		this.controlAliases = []
	}
	async init(config) {
		this.updateStatus('Starting')
		this.config = config
		if (this.config.host === undefined || this.config.port === undefined) {
			this.log('error', 'Host or port undefined')
			this.updateStatus(InstanceStatus.BadConfig)
			return undefined
		}
		this.initVariables()
		this.startTimeOut()
		this.updateActions() // export actions
		this.updateFeedbacks() // export feedbacks
		this.updateVariableDefinitions() // export variable definitions
		this.updateVariableValues()
		this.initTCP()
	}
	// When module gets deleted
	async destroy() {
		this.log('debug', `destroy. ID: ${this.id}`)
		this.stopKeepAlive()
		this.stopCmdQueue()
		this.stopTimeOut()
		this.stopActionUpdateTimer()
		if (this.socket) {
			this.socket.destroy()
		}
		this.updateStatus(InstanceStatus.Disconnected)
	}

	updateVariableValues() {
		let varList = []
		this.setVariableValues(varList)
	}

	initVariables() {
	}

	updateActions() {
		UpdateActions(this)
	}

	updateFeedbacks() {
		UpdateFeedbacks(this)
	}

	updateVariableDefinitions() {
		UpdateVariableDefinitions(this)
	}
}

runEntrypoint(PEAVY_RATC, UpgradeScripts)
