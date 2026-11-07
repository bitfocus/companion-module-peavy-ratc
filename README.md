# companion-module-peavy-ratc

See [HELP.md](./companion/HELP.md) and [LICENSE](./LICENSE)

This module is no longer being maintained, contributions from others are welcomed.

## Version History

### Version 2.0.0

- Requires Companion 5.1 or later (module API 2.2)
- Action options can be expressions. A Control Alias holding variables, and numeric values typed as text, are converted on existing buttons
- Values and positions are number fields
- Password config field stored as a module secret
- Actions fail while not logged in, rather than being queued until the next login
- Actions and variables are updated once the control list is complete, rather than once per alias, so large projects load faster
- RATCv2: logs in again only once when the DSP reports it is not logged in
- Converted to TypeScript, with unit tests
- Fix: RATCv1 Control Set sent `controSet`, which the DSP rejected
- Fix: Control Set String always failed
- Fix: Change Group Control Remove with a named change group sent a malformed command
- Fix: replies the DSP flags as alerts were not recognised, so a failed login could be missed
- Fix: RATCv1 queried listed controls with a RATCv2 command
- Fix: aliases and variables were listed again on every reconnection, and aliases no longer in the project were kept

### Version 1.1.4

- Better sanitising of variable Ids

### Version 1.1.3

- Parse local variables

### Version 1.1.2

- Use Node 22
- Update dependencies

### Version 1.1.1

- Minor fixes
- Update dependencies

### Version 1.1.0

- Action Recorder
- Update dependencies

### Version 1.0.3

- Minor fixes

### Version 1.0.1

- Better status updates
- Minor fixes & typos
- Companion-module-base updated to 1.8.0

### Version 1.0.0

- Initial release
