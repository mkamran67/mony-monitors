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

			this.originalMonitorOrientation = new Map(); // Store monitor configuration based on serial

			this.setupUI(); // Adds UI buttons
			this.setup(); // Proxy + Configuration + Listeners + list of monitors
		}

		async setup() {
			try {
				// 1. Setup Mutter Proxy
				await this.setupMutterProxy();
				if (!this.mutterProxy) {
					throw new Error("Mutter D-bus proxy setup failed.");
				}

				// 2. Get monitors from D-BUS; this is the format we save in -> See dummy/mutterConfigResponse.json
				this.currentMonitorConfig = await this.getCurrentMonitorConfig();
				this.originalMonitorConfig = JSON.parse(JSON.stringify(this.currentMonitorConfig)); // REVIEW -> Needed?

				if (!this.currentMonitorConfig) {
					throw new Error("Failed to get Monitor Configuration from DBus");
				}

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

		updateUI() {
			if (this.monitorList) {
				this.monitorList.removeAll();
			}

			if (this.currentMonitorConfig) {
				this.checked =
					this.currentMonitorConfig.monitors.length ===
					this.currentMonitorConfig.logical_monitors.length;

				this.saveConfiguration();
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
				console.log(
					"🚀 ~ DisplayMenu ~ refreshConfig ~ currentMonitorConfig:",
					this.currentMonitorConfig
				);
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

			console.log(
				"🚀 ~ DisplayMenu ~ convertLogicalMonitors ~ newLogicalMonitors:",
				newLogicalMonitors
			);
			return newLogicalMonitors;
		}

		getResolutionMode(serial) {
			let currentReso = null;
			let preferredReso = null;
			let highestReso = null;

			for (let i = 0; i < this.currentMonitorConfig.monitors.length; i++) {
				const monitor = array[i];
				const properties = monitor[0];

				// Find the matching monitor in configuration
				if (properties[properties.length - 1] === serial) {
					// iterate through and find either is-current, is-preferred or the highest resolution possible
					for (let j = 0; j < monitor[1].length; j++) {
						const modeInfo = monitor[1][j]; // ["1600x920@60.000", 1600, 920, 60, 1, [1], {}] <- Example of modeInfo

						const lastVal = modeInfo[modeInfo.length - 1]; // ["1440x900@60.000",1440,900,60,1,[1],{"is-current": {}}], <- With lastVal

						if (Object.hasOwn(lastVal, "is-current")) {
							currentReso = modeInfo;
						} else if (Object.hasOwn(lastVal, "is-preferred")) {
							preferredReso = modeInfo;
						} else if (j == 0) {
							highestReso = modeInfo;
						}
					}
				}
			}

			return {
				currentReso,
				preferredReso,
				highestReso,
			};
		}

		generateMonitorFromMutterConfig() {}

		generateMonitorsFromLogicalMonitors() {
			let newConfig = [];
			let offset = {
				x: 0,
				y: 0,
			};
			const { logical_monitors } = this.currentMonitorConfig;

			logical_monitors.forEach((monitor) => {
				const [x, y, scale, transform, isPrimary, properties] = monitor;
				const [connecter, brand, model, serial] = properties;

				const { currentReso, preferredReso, highestReso } = getResolution(serial); // ["1440x900@60.000",1440,900,60,1,[1],{"is-current": {}}], <- Resolution Mode

				const resolutionMode = currentReso || preferredReso || highestReso;
				offset.x += resolutionMode[1];
				offset.y += resolutionMode[2];
				const gVariantProps = {
					"width-in-pixels": new GLib.Variant("u", resolutionMode[1]),
					"height-in-pixels": new GLib.Variant("u", resolutionMode[2]),
					"refresh-rate": new GLib.Variant("d", resolutionMode[3]),
				};

				const physicalProps = [[connecter, resolutionMode[0] || "", gVariantProps]];

				const tempMonitor = {
					x,
					y,
					scale,
					transform,
					isPrimary,
					physicalProps,
				};

				newConfig.push(tempMonitor);
			});

			return { logicalConfig: newConfig, offset };
		}

		generateNewMonitorConfig(toAdd, serialArr = []) {
			try {
				// Assuming we are adding
				// 1. Take current logical_monitors and generate a new configuration to push via proxy
				const { monitors } = this.currentMonitorConfig;
				const { logicalConfig, offset } = this.generateMonitorsFromLogicalMonitors();
				let oneTime = logicalConfig.length > 0 ? true : false;

				// 2. Take incoming serialArr, iterate through and add monitor config
				// TODO -> Add a way to get config from initial/previous full setup
				const newMonitorConfig = serialArr.map((serial) => {
					// find the relevant monitors config
					const monitorConfig = monitors.find((m) => {
						const serialIndex = m[0].length - 1;

						if (m[0][serialIndex] === serial) return true;

						return false;
					});
					const [connector, brand, model, serial] = monitorConfig[0];
					const { currentReso, preferredReso, highestReso } = this.getResolutionMode(serial);

					let resolutionModeInfo = null;

					if (currentReso) {
						resolutionModeInfo = currentReso;
					} else if (preferredReso) {
						resolutionModeInfo = preferredReso;
					} else {
						resolutionModeInfo = highestReso;
					}

					const physicalProps = {
						"width-in-pixels": new GLib.Variant("u", resolutionModeInfo[1]),
						"height-in-pixels": new GLib.Variant("u", resolutionModeInfo[2]),
						"refresh-rate": new GLib.Variant("d", resolutionModeInfo[3]),
					};

					// build new config from monitor details + offset
					const newMonitorConfig = [
						offset.x,
						offset.y,
						1, // scale
						0, // transformation
						false, // primary flag setup later
						[[connector, resolutionModeInfo[0], physicalProps]],
					];
				});

				return [...logicalConfig, ...newMonitorConfig];
			} catch (error) {
				console.error("Failed to generateNewMonitorConfig");
				console.error(error);
				return;
			}
		}

		testGen() {
			const lvds1_connector = "LVDS1";
			const lvds1_vendor = "1440x900@60.000"; // From your data, or use ""
			const lvds1_properties = {
				"width-in-pixels": new GLib.Variant("u", 1440),
				"height-in-pixels": new GLib.Variant("u", 900),
				"refresh-rate": new GLib.Variant("d", 60.0),
			};

			const logical_monitor_lvds1 = [
				0, // x position
				0, // y position
				1.0, // scale
				0, // transform (0 for normal)
				true, // is_primary: true (let's make LVDS1 primary)
				[
					// array of physical monitors backing this logical monitor
					[lvds1_connector, lvds1_vendor, lvds1_properties],
				],
			];

			// ----- Configuration for LVDS2 (the currently active one) -----
			const lvds2_connector = "LVDS2";
			const lvds2_vendor = "1440x900@60.000"; // From your data, or use ""
			const lvds2_properties = {
				"width-in-pixels": new GLib.Variant("u", 1440), // Assuming we keep its 1440x900 mode
				"height-in-pixels": new GLib.Variant("u", 900),
				"refresh-rate": new GLib.Variant("d", 60.0),
			};

			const logical_monitor_lvds2 = [
				1440, // x position (to the right of LVDS1, which is 1440px wide)
				0, // y position
				1.0, // scale
				0, // transform (0 for normal)
				false, // is_primary: false
				[
					// array of physical monitors backing this logical monitor
					[lvds2_connector, lvds2_vendor, lvds2_properties],
				],
			];

			// ----- Combine them into the final newMonitorConfig -----
			const newMonitorConfig = [logical_monitor_lvds1, logical_monitor_lvds2];

			if (this.testVal) {
				return [logical_monitor_lvds1];
			}
			return newMonitorConfig;
		}

		async updateMonitorConfig() {
			try {
				if (!this.mutterProxy) {
					throw new Error("No Proxy");
				}
				const { serial } = this.currentMonitorConfig;
				let newMonitorConfig = this.testGen();
				this.testVal = !this.testVal;

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
			const logical_monitors = this.currentMonitorConfig.logical_monitors;

			// Iterate and build MenuItems to add to the menu
			this.currentMonitorConfig.monitors.forEach((currentMonitor, index) => {
				// 1. Find if monitor is active
				const currSerial = currentMonitor[0][currentMonitor[0].length - 1];
				const currResolution = currentMonitor[1].find((m) => {
					const hasProperty = Object.hasOwn(m[6], "is-current");

					if (hasProperty) return true;
				});
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

		// Toggles the monitor ON or OFF
		// if monitor is currently in the active stack -> deactivate it
		// else if it's not in the active stack -> activate it
		toggleMonitor(currSerial) {
			try {
				if (!this.mutterProxy) {
					throw new Error("No Proxy");
				}

				const isCurrentlyActive = this.isMonitorCurrentlyActive(currSerial);
				// 1. Check if in logical_monitors
				// 		T -> remove from logical_monitors
				if (isCurrentlyActive) {
					this.disableMonitor(currSerial);
				} else {
					//		F -> add
					this.enableMonitor(currSerial);
				}

				// // Push new monitor configuration -> actual changes to displays
				this.updateMonitorConfig();
			} catch (error) {
				console.error(error);
			}
		}

		disableMonitor(monitorSerial) {
			try {
				// Filter out the removing monitor and reassign
				this.currentMonitorConfig.logical_monitors =
					this.currentMonitorConfig.logical_monitors.filter((monitor) => {
						const tempDeets = monitor[5][0];
						const tempSerial = tempDeets[tempDeets.length - 1];

						if (tempSerial !== monitorSerial) {
							return true;
						}
					});

				return true;
			} catch (error) {
				console.error(error);
				return false;
			}
		}

		enableMonitor(monitorSerial) {}

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

		shallowCompare(arr1, arr2) {
			if (arr1.length !== arr2.length) {
				return false;
			}
			for (let i = 0; i < arr1.length; i++) {
				if (arr1[i] !== arr2[i]) {
					return false;
				}
			}
			return true;
		}

		setupUI() {
			// Add a header with an icon, title and optional subtitle.
			this.menu.setHeader("monitor-pick-symbolic", _("Select Monitors"), _(""));

			// Add a section of items to the menu
			this.monitorList = new PopupMenu.PopupMenuSection();
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
