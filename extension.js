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

			// 2. Get Monitors
			this._DBusMonitors = await this.getResources();

			// 3. Update SetItems with new Monitor information
			if (this._DBusMonitors) {
				console.log(`Got Monitors from DBus`);
				await this._updateMonitorsWithDBus();
			}
		}

		_updateMonitors() {
			// Clear Existing items
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

		async _updateMonitorsWithDBus() {
			const { outputs, crtcs } = this._DBusMonitors;

			// // Update list
			const primaryMonitorIndex = global.display.get_primary_monitor();
			this._itemsSection.removeAll();

			outputs.forEach((output, index) => {
				const [id, winsysId, currentCrtc, possibleCrtcs, name, validModes, clones, properties] =
					output;

				// const isActive = monitor.geometry.width
				const isActive = currentCrtc !== -1;
				const isPrimary = primaryMonitorIndex == id;

				// Create a toggle switch menu item
				const menuItem = new PopupMenu.PopupSwitchMenuItem(
					`${name} - ${index + 1} ${isPrimary ? ": Primary" : ""} `,
					isActive
				);

				menuItem.connect("toggled", () => {
					// crtcs for turning it off
					this._toggleMonitor(currentCrtc, !isActive);
				});

				this._itemsSection.addMenuItem(menuItem);
			});
		}

		async getResources() {
			try {
				if (!this._proxy) {
					throw new Error("No Proxy");
				}

				const getMonitorsPromise = new Promise((resolve, reject) => {
					// First get the current configuration
					this._proxy.call(
						"GetResources",
						null,
						Gio.DBusCallFlags.NONE,
						-1,
						null,
						(proxy, result) => {
							try {
								const [serial, crtcs, outputs, modes] = proxy.call_finish(result).deep_unpack();
								resolve({ outputs, crtcs, serial });
							} catch (e) {
								reject(e);
							}
						}
					);
				});
				return await getMonitorsPromise;
			} catch (error) {
				console.log("file: extension.js:160 -> error:", error);
			}
		}

		async _toggleMonitor(currentCrtc, toEnable) {
			try {
				if (!this._proxy) {
					throw new Error("No Proxy");
				}

				const crtcConfig = [
					[
						currentCrtc, // CRTC ID
						-1, // mode (-1 = disabled)
						0, // x
						0, // y
						0, // transform
						[], // no outputs
						{}, // properties
					],
				];

				const toggleMonitor = new Promise((resolve, reject) => {
					// Apply the configuration
					this._proxy.call(
						"ApplyConfiguration",
						new GLib.Variant("(uba(uiiiuaua{sv})a(ua{sv}))", [
							this._DBusMonitors.serial,
							false, // not persistent
							crtcConfig,
							[], // no output property changes
						]),
						Gio.DBusCallFlags.NONE,
						-1,
						null,
						(proxy, result) => {
							try {
								resolve(result);
							} catch (e) {
								reject(e);
							}
						}
					);
				});
				await toggleMonitor;
			} catch (error) {
				console.log("file: extension.js:201 -> error:", error);
			}
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
