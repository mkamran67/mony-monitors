// /* extension.js
//  *
//  * This program is free software: you can redistribute it and/or modify
//  * it under the terms of the GNU General Public License as published by
//  * the Free Software Foundation, either version 2 of the License, or
//  * (at your option) any later version.
//  *
//  * This program is distributed in the hope that it will be useful,
//  * but WITHOUT ANY WARRANTY; without even the implied warranty of
//  * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
//  * GNU General Public License for more details.
//  *
//  * You should have received a copy of the GNU General Public License
//  * along with this program.  If not, see <http://www.gnu.org/licenses/>.
//  *
//  * SPDX-License-Identifier: GPL-2.0-or-later
//  */
import GObject from "gi://GObject";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as QuickSettings from "resource:///org/gnome/shell/ui/quickSettings.js";
import { Extension, gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { SystemIndicator } from "resource:///org/gnome/shell/ui/quickSettings.js";

const DisplayMenu = GObject.registerClass(
	class DisplayMenu extends QuickSettings.QuickMenuToggle {
		_init() {
			super._init({
				title: _("Displays"),
				subtitle: _("Monitors"),
				iconName: "display-symbolic",
				toggleMode: true,
			});

			console.clear();
			// All Variables used in app will be initialized here
			this.monitorList = null; // holds list of monitors for toggling on/off
			this.mutterProxy = null; // This will be the DBus Proxy we use to communicate
			this.currentMonitorConfig = null; // holds the monitor configuration from mutter
			this.originalMonitorConfig = null; // This will be set on initial setup
			this.chooseHighestRes = null; // TODO -> Add settings schema + value

			this.originalMonitorOrientation = new Map(); // Store monitor configuration based on serial

			this.setupUI(); // Adds UI buttons
			this.setup(); // Proxy + Configuration + Listeners + list of monitors
		}

		setupUI() {
			// Add a header with an icon, title and optional subtitle.
			this.menu.setHeader("monitor-pick-symbolic", _("Select Monitors"), _(""));

			// Add a section of items to the menu
			this.monitorList = new PopupMenu.PopupMenuSection();
		}

		async setup() {
			try {
				// 1. Setup Mutter Proxy
				await this.setupMutterProxy();
				if (!this.mutterProxy) {
					throw new Error("Mutter D-bus proxy setup failed.");
				}

				// 2. Get monitors from D-BUS; this is the format we save in -> See dummy/mutterConfigResponse.json
				await this.refreshConfig();
				this.originalMonitorConfig = JSON.parse(JSON.stringify(this.currentMonitorConfig)); // REVIEW -> Needed?

				// 3. Listeners
				this.connect("notify::checked", () => this.onMainToggleClickHandler());

				// TODO -> add a listener for updating this.currentMonitorConfig & this.updateUI

				// 4. Setup UI -> Update
				this.updateUI(); // Adds monitor list
			} catch (error) {
				console.error(error);
				process.exit(1);
			}
		}

		saveConfiguration() {
			this.currentMonitorConfig.logical_monitors.forEach((monitor) => {
				const monitorProps = monitor[5];
				const monitorSerial = monitorProps[monitorProps.length - 1];

				this.originalMonitorOrientation.set(monitorSerial, monitor);
			});
		}

		compareIfOriginalConfigHasMonitor(serial) {
			for (let i = 0; i < this.originalMonitorConfig.monitors.length; i++) {
				const monitor = this.originalMonitorConfig.monitors[i];
				const monitorSerial = monitor[0][monitor[0].length - 1]; // serial
				if (monitorSerial === serial) {
					return monitor;
				}
			}

			for (let i = 0; i < this.currentMonitorConfig.monitors.length; i++) {
				const monitor = this.currentMonitorConfig.monitors[i];
				const monitorSerial = monitor[0][monitor[0].length - 1]; // serial
				if (monitorSerial === serial) {
					return monitor;
				}
			}
		}

		updateUI() {
			if (this.monitorList) {
				this.monitorList.removeAll();
			}

			if (this.currentMonitorConfig) {
				this.checked =
					this.currentMonitorConfig.monitors.length ===
					this.currentMonitorConfig.logical_monitors.length;

				this.updateMonitors();
			} else {
				console.log(`No Monitors found?`);
				console.error(this.currentMonitorConfig);
			}
		}

		async onMainToggleClickHandler() {
			// REFACTOR
			if (this.checked) {
				// Turn on all monitors
				// await this.turnOnAllMonitors();
			} else {
				// turn off all monitors <- except primary
				// await this.turnOffAllSecondaryMonitors();
			}
		}

		async refreshConfig() {
			try {
				this.currentMonitorConfig = await this.getCurrentMonitorConfig();

				if (!this.currentMonitorConfig) {
					throw new Error("Failed to get Monitor Configuration from DBus");
				}

				this.saveConfiguration();
			} catch (error) {
				console.warn("Failed to refresh config");
				console.error(error);
			}
		}

		convertLogicalMonitors() {
			const newLogicalMonitors = [];
			const { monitors, logical_monitors } = this.currentMonitorConfig;

			for (const currMonitor of logical_monitors) {
				const [x, y, scale, transform, primary, monitorSpecs] = currMonitor;

				// Convert monitor specs to new format
				const newMonitorSpecs = monitorSpecs.map((spec) => {
					const [connector, vendor, product, serial] = spec;

					// Find current mode ID from monitors array
					const monitorInfo = monitors.find((m) => {
						const [info] = m;
						const [mConnector, mVendor, mProduct, mSerial] = info;
						return connector === mConnector;
					});

					// if no modes exist -> throw
					if (monitorInfo?.[1][0].length == 0) {
						throw new Error("No modes found", monitorInfo?.[1][0]);
					}
					// Get current mode ID
					let currentModeId =
						monitorInfo?.[1].find((mode) => mode[6]?.["is-current"])?.[0] ||
						monitorInfo?.[1].find((mode) => mode[6]?.["is-preferred"])?.[0];

					if (!currentModeId) {
						currentModeId = monitorInfo?.[1][monitorInfo?.[1].length - 1][0];
						console.error(`Couldn't find the right mode - Falling bhack to :`, currentModeId);
					}
					return [
						connector, // connector name
						currentModeId, // mode ID
						{}, // properties
					];
				});

				// Create new logical monitor config
				const newMonitorConfig = [
					x, // x position
					y, // y position
					scale, // scale
					transform, // transform
					primary, // primary flag
					newMonitorSpecs, // monitor specs in new format
				];

				newLogicalMonitors.push(newMonitorConfig);
			}

			return newLogicalMonitors;
		}

		getResolutionMode(serial) {
			const monitor = this.compareIfOriginalConfigHasMonitor(serial);

			// Loop through and find the matching monitor in dbus
			const properties = monitor[0];

			// Find the matching monitor in configuration
			if (properties[properties.length - 1] === serial) {
				// Iterate through and if is-current exists return that modeinfo
				for (let j = 0; j < monitor[1].length; j++) {
					const modeInfo = monitor[1][j]; // ["1600x920@60.000", 1600, 920, 60, 1, [1], {}] <- Example of modeInfo
					const lastVal = modeInfo[modeInfo.length - 1]; // ["1440x900@60.000",1440,900,60,1,[1],{"is-current": {}}], <- With lastVal

					if (Object.hasOwn(lastVal, "is-current")) {
						console.log(`returning`);
						return modeInfo;
					}
				}

				for (let j = 0; j < monitor[1].length; j++) {
					const modeInfo = monitor[1][j]; // ["1600x920@60.000", 1600, 920, 60, 1, [1], {}] <- Example of modeInfo
					const lastVal = modeInfo[modeInfo.length - 1]; // ["1440x900@60.000",1440,900,60,1,[1],{"is-current": {}}], <- With lastVal

					if (Object.hasOwn(lastVal, "is-preferred")) {
						return modeInfo;
					}
				}

				const modeInfo = monitor[1][0]; // ["1600x920@60.000", 1600, 920, 60, 1, [1], {}] <- Example of modeInfo
				return modeInfo;
			}
		}

		generateMonitorsFromLogicalMonitors(subtractArr = []) {
			let newConfig = [];
			let offset = {
				x: 0,
				y: 0,
			};
			const { logical_monitors } = this.currentMonitorConfig;

			logical_monitors.forEach((monitor) => {
				const [x, y, scale, transform, isPrimary, properties] = monitor;

				const [connecter, brand, model, serial] = properties[0];

				// Skipping from adding
				if (subtractArr.length > 0 && subtractArr.includes(serial)) {
					return;
				}

				const resolutionModeInfo = this.getResolutionMode(serial); // ["1440x900@60.000",1440,900,60,1,[1],{"is-current": {}}], <- Resolution Mode

				offset.x += resolutionModeInfo[1];
				// offset.y += resolutionModeInfo[2]; // TODO -> Implement a dynamic save and refil approach

				const gVariantProps = {
					"width-in-pixels": new GLib.Variant("u", 1440),
					"height-in-pixels": new GLib.Variant("u", 900),
					"refresh-rate": new GLib.Variant("d", 60.0),
				};

				const physicalProps = [[connecter, resolutionModeInfo[0] || "", gVariantProps]];

				const tempMonitor = [x, y, scale, transform, isPrimary, physicalProps];

				newConfig.push(tempMonitor);
			});

			return { logicalConfig: newConfig, offset };
		}

		generateMonitorsFromDbus(offset, serialArr) {
			const { monitors } = this.currentMonitorConfig;

			const newMonitorConfig = serialArr.map((incomingSerial) => {
				// find the relevant monitors config
				const monitorConfig = monitors.find((m) => {
					const serialIndex = m[0].length - 1;

					if (m[0][serialIndex] === incomingSerial) return true;

					return false;
				});

				const [connector, brand, model, serial] = monitorConfig[0];
				const resolutionModeInfo = this.getResolutionMode(serial);
				console.log(
					"🚀 ~ DisplayMenu ~ newMonitorConfig ~ resolutionModeInfo:",
					resolutionModeInfo
				);

				const physicalProps = {
					"width-in-pixels": new GLib.Variant("u", 1440),
					"height-in-pixels": new GLib.Variant("u", 900),
					"refresh-rate": new GLib.Variant("d", 60.0),
				};

				// build new config from monitor details + offset
				return [
					offset.x,
					offset.y,
					1, // scale
					0, // transformation
					false, // primary flag setup later
					[[connector, resolutionModeInfo[0], physicalProps]],
				];
			});

			return newMonitorConfig;
		}

		generateNewMonitorConfig(toAdd, serialArr) {
			try {
				if (toAdd) {
					// Assuming we are adding
					// 1. Take current logical_monitors and generate a new configuration to push via proxy
					const { logicalConfig, offset } = this.generateMonitorsFromLogicalMonitors();

					// 2. Take incoming serialArr, iterate through and add monitor config
					// TODO -> Add a way to get config from initial/previous full setup
					const newMonitorConfig = this.generateMonitorsFromDbus(offset, serialArr);

					return [...logicalConfig, ...newMonitorConfig];
				} else {
					// Assuming we are subtract
					// 1. Take current logical_monitors and remove the specified monitor
					const { logicalConfig, offset } = this.generateMonitorsFromLogicalMonitors(serialArr);
					return [...logicalConfig];
				}
			} catch (error) {
				console.error("Failed to generateNewMonitorConfig");
				console.error(error);
				return;
			}
		}

		async updateMonitorConfig(newMonitorConfig) {
			try {
				if (!this.mutterProxy) {
					throw new Error("No Proxy");
				}
				const { serial } = this.currentMonitorConfig;

				const params = new GLib.Variant("(uua(iiduba(ssa{sv}))a{sv})", [
					serial, // u: serial
					1, // u: method (temporary)
					newMonitorConfig, // a(...): logical monitors array
					{}, // a{sv}: properties
				]);

				// a(iiduba(ssa{sv}))
				await new Promise((resolve, reject) => {
					this.mutterProxy.call(
						"ApplyMonitorsConfig",
						params,
						Gio.DBusCallFlags.NONE,
						-1,
						null,
						(proxy, result) => {
							try {
								proxy.call_finish(result);
								resolve();
							} catch (e) {
								console.log("file: extension.js:102 -> e:", e);
								reject(e);
							}
						}
					);
				});

				// Refresh Serial
				await this.refreshConfig();
			} catch (error) {
				console.error(error);
			}
		}

		updateMonitors() {
			const { logical_monitors } = this.currentMonitorConfig;

			// Iterate and build MenuItems to add to the menu
			this.currentMonitorConfig.monitors.forEach((currentMonitor, index) => {
				const currSerial = currentMonitor[0][currentMonitor[0].length - 1]; // Serial of monitor

				const currResolution = currentMonitor[1].find((m) => {
					const hasProperty = Object.hasOwn(m[6], "is-current");

					if (hasProperty) return true;
				}); // resolution modeInfo

				const currLogicalMonitor = logical_monitors.find((m) => {
					const mDeets = m[5][0];
					const mSerial = mDeets[mDeets.length - 1];
					if (mSerial === currSerial) {
						return true;
					}
				}); // if current monitor is in logicalMonitors

				const isActive = currLogicalMonitor ? true : false;
				const isPrimary = currLogicalMonitor[4]; // Primary Flag

				const toggleListItemTitle = `${isPrimary ? "Primary" : "Monitor"} ${index + 1} : ${
					currResolution[1]
				}x${currResolution[2]}`;

				// Create a toggle switch menu item
				const menuItem = new PopupMenu.PopupSwitchMenuItem(toggleListItemTitle, isActive);

				menuItem.connect("toggled", () => {
					this.toggleMonitor(currSerial);
				});

				this.monitorList.addMenuItem(menuItem);
			});

			this.menu.addMenuItem(this.monitorList);
		}

		toggleMonitor(currSerial) {
			try {
				if (!this.mutterProxy) {
					throw new Error("No Proxy");
				}

				const isCurrentlyActive = this.isMonitorCurrentlyActive(currSerial);
				console.log("🚀 ~ DisplayMenu ~ toggleMonitor ~ isCurrentlyActive:", isCurrentlyActive);
				// 1. Check if in logical_monitors
				// 		T -> remove from logical_monitors
				if (isCurrentlyActive) {
					this.disableMonitor(currSerial);
				} else {
					//		F -> add
					this.enableMonitor(currSerial);
				}
			} catch (error) {
				console.error(error);
			}
		}

		async disableMonitor(monitorSerial) {
			try {
				const newMonitorConfig = this.generateNewMonitorConfig(false, [monitorSerial]);

				// TODO -> If 1 left, change to primary and offsets to 0,0
				// TODO -> Figure out why you can't turn off primary
				await this.updateMonitorConfig(newMonitorConfig);
				return true;
			} catch (error) {
				console.error(error);
				return false;
			}
		}

		async disableAllExceptPrimary() {
			try {
				// TODO -> After the primary bug
			} catch (error) {
				console.error(error);
				return;
			}
		}

		async enableMonitor(monitorSerial) {
			try {
				const newMonitorConfig = this.generateNewMonitorConfig(true, [monitorSerial]);
				await this.updateMonitorConfig(newMonitorConfig);
				return true;
			} catch (error) {
				console.error(error);
				return false;
			}
		}

		isMonitorCurrentlyActive(currSerial) {
			const logicalMonitors = this.currentMonitorConfig.logical_monitors;

			for (const testM of logicalMonitors) {
				const tempDeets = testM[5][0];

				const isEqual = tempDeets[tempDeets.length - 1] === currSerial;

				if (isEqual) {
					return true;
				}
			}

			return false;
		}

		async setupMutterProxy() {
			try {
				const myProxyPromise = new Promise((resolve, reject) => {
					Gio.DBusProxy.new_for_bus(
						Gio.BusType.SESSION,
						Gio.DBusProxyFlags.NONE,
						null,
						"org.gnome.Mutter.DisplayConfig",
						"/org/gnome/Mutter/DisplayConfig",
						"org.gnome.Mutter.DisplayConfig",
						null,
						(source, result) => {
							try {
								this.mutterProxy = Gio.DBusProxy.new_for_bus_finish(result);
								resolve(this.mutterProxy);
							} catch (e) {
								console.log("file: extension.js:275 -> e:", e);
								reject(e);
							}
						}
					);
				});

				return await myProxyPromise;
			} catch (error) {
				console.error(error);
				return;
			}
		}

		async getCurrentMonitorConfig() {
			try {
				if (!this.mutterProxy) {
					throw new Error("No Proxy");
				}

				return new Promise((resolve, reject) => {
					this.mutterProxy.call(
						"GetCurrentState",
						null,
						Gio.DBusCallFlags.NONE,
						-1,
						null,
						(proxy, result) => {
							try {
								const [serial, monitors, logical_monitors, properties] = proxy
									.call_finish(result)
									.deep_unpack();
								resolve({ serial, monitors, logical_monitors, properties });
							} catch (e) {
								reject(e);
							}
						}
					);
				});
			} catch (error) {
				console.error(error);
			}
		}

		// REFACTOR -> Unused?
		async updateMonitorsWithDBus() {
			try {
				const { logical_monitors, monitors } = this.currentMonitorConfig;
				this.activeStack = [...logical_monitors]; // inital save of active monitors

				// For now lets use logical_monitors and store them
				logical_monitors.forEach((monitor, index) => {
					const [x, y, scale, transform, isPrimary, monitorProperties, props] = monitor;
					const possibleName = monitorProperties[0][0];
					const isActive = true;

					// Create a toggle switch menu item
					const menuItem = new PopupMenu.PopupSwitchMenuItem(
						`${possibleName || "Monitor"} : ${index + 1} ${isPrimary ? " (Primary)" : ""} `,
						isActive
					);

					menuItem.connect("toggled", () => {
						this.toggleMonitor(monitor); // This will turn off the monitor and keep the button there
					});

					this.monitorList.addMenuItem(menuItem);
				});
			} catch (error) {
				console.log("file: extension.js:97 -> error:", error);
			}
		}
	}
);

const MonyMonitorsIndicator = GObject.registerClass(
	// The SystemIndicator class is the container for our ExampleToggle
	class MonyMonitorsIndicator extends SystemIndicator {
		constructor(extensionObject) {
			super();

			this._menuToggle = new DisplayMenu(extensionObject);
			this.quickSettingsItems.push(this._menuToggle);
		}
	}
);

export default class QuickSettingsExampleExtension extends Extension {
	enable() {
		this._indicator = new MonyMonitorsIndicator(this);
		Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
	}

	disable() {
		this._indicator.quickSettingsItems.forEach((item) => item.destroy());
		this._indicator.destroy();
	}
}
