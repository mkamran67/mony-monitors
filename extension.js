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
import St from "gi://St";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
// import Meta from "gi://Meta"; // Useless for turning off/on monitors aka not for it.
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as QuickSettings from "resource:///org/gnome/shell/ui/quickSettings.js";
import { Extension, gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { QuickToggle, SystemIndicator } from "resource:///org/gnome/shell/ui/quickSettings.js";

const DisplayMenu = GObject.registerClass(
	class DisplayMenu extends QuickSettings.QuickMenuToggle {
		// _init(extensionObject) {
		_init() {
			super._init({
				title: _("Displays"),
				subtitle: _("Monitors"),
				iconName: "display-symbolic",
				toggleMode: true,
			});

			// Add a header with an icon, title and optional subtitle.
			this.menu.setHeader("monitor-pick-symbolic", _("Select Monitors"), _(""));

			// Add a section of items to the menu
			this._itemsSection = new PopupMenu.PopupMenuSection();
			// TODO -> add a listener for monitor changes
			this._updateMonitors();

			this.menu.addMenuItem(this._itemsSection);

			this._setup();
		}

		async _setup() {
			// 1. Setup Mutter Proxy
			await this._setupMutterProxy();
			if (this._proxy) {
				console.log(`Proxy has been setup.`);
			}

			// 2. Get Monitors -> save to an unchanging array
			this._originalResources = await this.getResources();

			// 3. Update SetItems with new Monitor information
			if (this._originalResources) {
				this._monitorResources = { ...this._originalResources };
				await this._updateMonitorsWithDBus();
			}
		}

		async _updateMonitorConfig() {
			try {
				if (!this._proxy) {
					throw new Error("No Proxy");
				}
				const { serial, monitors } = this._originalResources;
				console.log("file: extension.js:76 -> monitors:", monitors);
				console.log("file: extension.js:77 -> this._activeStack:", this._activeStack);

				// 	[
				//     0, x
				//     0, y
				//     1, scale
				//     0, transform
				//     true, primary
				//     [
				//         [
				//             "LVDS1",
				//             "MetaProducts Inc.",
				//             "MetaMonitor",
				//             "0xC0FFEE-1"
				//         ]
				//     ],
				//     {}
				// ],

				await new Promise((resolve, reject) => {
					this._proxy.call(
						"ApplyMonitorsConfig",
						new GLib.Variant("u", serial),
						new GLib.Variant("u", 1),
						new GLib.Variant("a(iiduba(ssa{sv}))", this._activeStack),
						new GLib.Variant("a{sv}", {}),
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
			} catch (error) {
				logError(error);
			}
		}

		// Takes a monitor and turns it on or off
		// if monitor is currently in the active stack
		// deactivate it
		// else if it's not in the active stack
		// activate it
		async _toggleMonitor(currentMonitor) {
			try {
				if (!this._proxy) {
					throw new Error("No Proxy");
				}
				const isCurrentlyActive = this._isMonitorCurrentlyActive(currentMonitor);

				// if currentlyActive -> turn off monitor and update list.
				if (isCurrentlyActive) {
					// remove from activelist
					this._activeStack = this._activeStack.filter(
						(actMonitor) => !this._shallowCompare(actMonitor, currentMonitor)
					);
				} else {
					// add to activelist
					this._activeStack.push(currentMonitor);
				}

				// Update monitors
				this._updateMonitorConfig();
			} catch (error) {
				logError(error);
			}
		}

		_isMonitorCurrentlyActive(monitor) {
			for (const currMonitor of this._activeStack) {
				const isEqual = this._shallowCompare(monitor, currMonitor);

				if (isEqual) {
					return true;
				}
			}

			return false;
		}

		async getResources() {
			try {
				if (!this._proxy) {
					throw new Error("No Proxy");
				}

				return new Promise((resolve, reject) => {
					this._proxy.call(
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
				logError(error);
			}
		}

		// This should run only once, later we update with stored values.
		async _updateMonitorsWithDBus() {
			try {
				this._itemsSection.removeAll();

				const { logical_monitors, monitors } = this._originalResources;
				this._activeStack = [...logical_monitors]; // inital save of active monitors

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

					menuItem.connect("toggled", async () => {
						await this._toggleMonitor(monitor); // This will turn off the monitor and keep the button there
					});

					this._itemsSection.addMenuItem(menuItem);
				});
			} catch (error) {
				console.log("file: extension.js:97 -> error:", error);
			}
		}

		_updateMonitors() {
			// TODO -> DELETE
			// Clear Existing items -> Dummy Monitors really...
			this._itemsSection.removeAll();

			// Get monitors from Main.layoutManager
			const monitors = Main.layoutManager.monitors;
			const primaryMonitorIndex = global.display.get_primary_monitor();

			monitors.forEach((monitor, index) => {
				// const isActive = monitor.geometry.width
				const isActive = monitor.width > 0 && monitor.height > 0;
				const isPrimary = primaryMonitorIndex == index;

				// Create a toggle switch menu item
				const menuItem = new PopupMenu.PopupSwitchMenuItem(
					`${isPrimary ? "Primary" : "Monitor"} ${index + 1}: ${monitor.width}x${monitor.height} `,
					isActive
				);

				menuItem.connect("toggled", async () => {
					await this._toggleMonitor(index, !isActive);
				});

				this._itemsSection.addMenuItem(menuItem);
			});
		}

		async _setupMutterProxy() {
			try {
				this._proxy = null;

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
								this._proxy = Gio.DBusProxy.new_for_bus_finish(result);
								resolve(this._proxy);
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
			}
		}

		_shallowCompare(arr1, arr2) {
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
	}
);
const MonyMonitorsIndicator = GObject.registerClass(
	// The SystemIndicator class is the container for our ExampleToggle
	class MonyMonitorsIndicator extends SystemIndicator {
		constructor() {
			super();

			this._menuToggle = new DisplayMenu();

			this.quickSettingsItems.push(this._menuToggle);
		}
	}
);

export default class QuickSettingsExampleExtension extends Extension {
	enable() {
		this._indicator = new MonyMonitorsIndicator();
		Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
	}

	disable() {
		this._indicator.quickSettingsItems.forEach((item) => item.destroy());
		this._indicator.destroy();
	}
}
