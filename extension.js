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
			this.INTIIAL_MONITOR_CONFIG = null; // holds the initial configuration

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

		updateUI() {
			if (this.monitorList) {
				this.monitorList.removeAll();
			}

			if (this.currentMonitorConfig) {
				this.updateMonitors();
			} else {
				console.log(`No Monitors found?`);
				console.error(this.currentMonitorConfig);
			}
		}

		async onMainToggleClickHandler() {
			if (this.checked) {
				// Turn on all monitors
				// await this.turnOnAllMonitors();
			} else {
				// turn off all monitors <- except primary
				// await this.turnOffAllSecondaryMonitors();
			}
		}

		convertLogicalMonitors(activeStack, dbusMonitors) {
			const newLogicalMonitors = [];
			const dbusMonitors = this.currentMonitorConfig.monitors;

			for (const monitor of activeStack) {
				const [x, y, scale, transform, primary, monitorSpecs] = monitor;

				// Convert monitor specs to new format
				const newMonitorSpecs = monitorSpecs.map((spec) => {
					const [connector, vendor, product, serial] = spec;

					// Find current mode ID from monitors array
					const monitorInfo = dbusMonitors.find((m) => {
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

		async updateMonitorConfig() {
			try {
				if (!this.mutterProxy) {
					throw new Error("No Proxy");
				}

				const { serial, monitors } = this.currentMonitorConfig;
				const newMonitorConfig = this.convertLogicalMonitors(this.activeStack, monitors);

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
				this.currentMonitorConfig = await this.getCurrentMonitorConfig();
			} catch (error) {
				console.error(error);
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

				if (isCurrentlyActive) {
					// REFACTOR -> No more activeStack
					// remove from activeStack
					this.activeStack = this.activeStack.filter(
						(actMonitor) => !this.shallowCompare(actMonitor, currentMonitor)
					);
				} else {
					// add to activeStack
					this.activeStack.push(currentMonitor);
				}

				// // Push new monitor configuration -> actual changes to displays
				// this.updateMonitorConfig();
			} catch (error) {
				console.error(error);
			}
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
