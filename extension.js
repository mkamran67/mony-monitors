/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import GObject from "gi://GObject";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as QuickSettings from "resource:///org/gnome/shell/ui/quickSettings.js";
import { Extension, gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { QuickToggle, SystemIndicator } from "resource:///org/gnome/shell/ui/quickSettings.js";

const ExampleMenuToggle = GObject.registerClass(
	class ExampleMenuToggle extends QuickSettings.QuickMenuToggle {
		_init(extensionObject) {
			super._init({
				title: _("Example Title"),
				subtitle: _("Example Subtitle"),
				iconName: "selection-mode-symbolic",
				toggleMode: true,
			});

			// Add a header with an icon, title and optional subtitle. This is
			// recommended for consistency with other quick settings menus.
			this.menu.setHeader("selection-mode-symbolic", _("Example Title"), _("Optional Subtitle"));

			// Add suffix to the header, to the right of the title.
			const headerSuffix = new St.Icon({
				iconName: "dialog-warning-symbolic",
			});
			this.menu.addHeaderSuffix(headerSuffix);

			// Add a section of items to the menu
			this._itemsSection = new PopupMenu.PopupMenuSection();
			this._itemsSection.addAction(_("Menu Item 1"), () => console.debug("Menu Item 1 activated!"));
			this._itemsSection.addAction(_("Menu Item 2"), () => console.debug("Menu Item 2 activated!"));
			this.menu.addMenuItem(this._itemsSection);

			// Add an entry-point for more settings
			this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
			const settingsItem = this.menu.addAction("More Settings", () =>
				extensionObject.openPreferences()
			);

			// Ensure the settings are unavailable when the screen is locked
			settingsItem.visible = Main.sessionMode.allowSettings;
			this.menu._settingsActions[extensionObject.uuid] = settingsItem;
		}
	}
);

const ExampleToggle = GObject.registerClass(
	class ExampleToggle extends QuickToggle {
		constructor() {
			super({
				title: _("Smile"),
				iconName: "face-smile-symbolic",
				toggleMode: true,
			});
		}
	}
);

const ExampleIndicator = GObject.registerClass(
	class ExampleIndicator extends SystemIndicator {
		constructor() {
			super();

			this._indicator = this._addIndicator();
			this._indicator.iconName = "face-smile-symbolic";

			const toggle = new ExampleToggle();
			toggle.bind_property("checked", this._indicator, "visible", GObject.BindingFlags.SYNC_CREATE);
			this.quickSettingsItems.push(toggle);
		}
	}
);

export default class QuickSettingsExampleExtension extends Extension {
	enable() {
		this._indicator = new ExampleIndicator();
		Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
	}

	disable() {
		this._indicator.quickSettingsItems.forEach((item) => item.destroy());
		this._indicator.destroy();
	}
}
