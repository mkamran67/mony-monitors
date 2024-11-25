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
			this._updateMonitors();

			this.menu.addMenuItem(this._itemsSection);
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
					`Monitor ${index + 1}: ${monitor.width}x${monitor.height} ${isPrimary ? "Primary" : ""}`,
					isActive
				);

				menuItem.connect("toggled", () => {
					this._toggleMonitor(index, !isActive);
				});

				this._itemsSection.addMenuItem(menuItem);
			});
		}

		_toggleMonitor(monitorIndex, enable) {
			try {
				const proxy = Gio.DBusProxy.new_for_bus_sync(
					Gio.BusType.SESSION,
					Gio.DBusProxyFlags.NONE,
					null,
					"org.gnome.Mutter.DisplayConfig",
					"/org/gnome/Mutter/DisplayConfig",
					"org.gnome.Mutter.DisplayConfig",
					null
				);

				// const [serial, monitors, logicalMonitors] = proxy.GetCurrentState();

				// Update the enabled staste of the selected monitor
				// monitors[monitorIndex][3]["is-enabled"] = new GLib.Variant("b", enable);

				// // Apply the new config
				// proxy.AppplyMonitorsConfig(
				// 	serial,
				// 	0, // Flags
				// 	monitors,
				// 	logicalMonitors
				// );

				const result = proxy.call_sync("GetCurrentState", null, Gio.DBusCallFlags.NONE, -1, null);
			} catch (err) {
				console.error(`Monitor Toggle Failed : ${err}`);
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
