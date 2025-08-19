#!/usr/bin/env python

import wx
import wx.adv
import wx.lib.inspection
import wx.lib.mixins.inspection

import sys
import os
import esptool
import threading
import json
import images as images
from serial import SerialException
from serial.tools import list_ports
import locale

# see https://discuss.wxpython.org/t/wxpython4-1-1-python3-8-locale-wxassertionerror/35168
locale.setlocale(locale.LC_ALL, "C")

__version__ = "5.1.0"
__flash_help__ = """
<p>This setting is highly dependent on your device!<p>
<p>
  Details at <a style="color: #004CE5;"
        href="https://www.esp32.com/viewtopic.php?p=5523&sid=08ef44e13610ecf2a2a33bb173b0fd5c#p5523">http://bit.ly/2v5Rd32</a>
  and in the <a style="color: #004CE5;" href="https://github.com/espressif/esptool/#flash-modes">esptool
  documentation</a>
<ul>
  <li>Most ESP32 and ESP8266 ESP-12 use DIO.</li>
  <li>Most ESP8266 ESP-01/07 use QIO.</li>
  <li>ESP8285 requires DOUT.</li>
</ul>
</p>
"""
__auto_select__ = "Auto-select"
__auto_select_explanation__ = "(first port with Espressif device)"
__supported_baud_rates__ = [9600, 57600, 74880, 115200, 230400, 460800, 921600]

# ---------------------------------------------------------------------------


# See discussion at http://stackoverflow.com/q/41101897/131929
class RedirectText:
    def __init__(self, text_ctrl):
        self.__out = text_ctrl

    def write(self, string):
        if string.startswith("\r"):
            current_value = self.__out.GetValue()
            last_newline = current_value.rfind("\n")
            new_value = current_value[: last_newline + 1]
            new_value += string[1:]
            wx.CallAfter(self.__out.SetValue, new_value)
        else:
            wx.CallAfter(self.__out.AppendText, string)

    def flush(self):
        pass

    def isatty(self):
        return True


# ---------------------------------------------------------------------------
class FlashingThread(threading.Thread):
    def __init__(self, parent, config):
        threading.Thread.__init__(self)
        self.daemon = True
        self._parent = parent
        self._config = config

    def run(self):
        try:
            command = []

            if not self._config.port.startswith(__auto_select__):
                command.extend(["--port", self._config.port])

            command.extend(
                [
                    "--baud", str(self._config.baud),
                    "--after", "no_reset",
                    "write_flash",
                    "--flash_size", "detect",
                    "--flash_mode", self._config.mode,
                    "0x00000", self._config.firmware_path,
                ]
            )

            if self._config.erase_before_flash:
                command.append("--erase-all")

            print(f"Command: esptool.py {' '.join(command)}\n")
            esptool.main(command)
            print("\nFirmware successfully flashed. Unplug/replug or reset device to switch back to normal boot mode.")
        except SerialException as e:
            self._parent.report_error(e.strerror)
            raise e

# ---------------------------------------------------------------------------
# DTO between GUI and flashing thread
class FlashConfig:
    def __init__(self):
        self.baud = 115200
        self.erase_before_flash = False
        self.mode = "dio"
        self.firmware_path = None
        self.port = None

    @classmethod
    def load(cls, file_path):
        conf = cls()
        if os.path.exists(file_path):
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                conf.port = data.get("port")
                conf.baud = data.get("baud")
                conf.mode = data.get("mode")
                conf.erase_before_flash = data.get("erase")
            except (IOError, json.JSONDecodeError):
                # Fallback to defaults if file is corrupt or unreadable
                pass
        return conf

    def safe(self, file_path):
        data = {
            "port": self.port,
            "baud": self.baud,
            "mode": self.mode,
            "erase": self.erase_before_flash,
        }
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f)

    def is_complete(self):
        return self.firmware_path is not None and self.port is not None

# ---------------------------------------------------------------------------
class NodeMcuFlasher(wx.Frame):
    def __init__(self, parent, title):
        wx.Frame.__init__(self, parent, -1, title, size=(725, 650), style=wx.DEFAULT_FRAME_STYLE | wx.NO_FULL_REPAINT_ON_RESIZE)
        self._config = FlashConfig.load(self._get_config_file_path())
        self.info_popup_window = None

        self._build_status_bar()
        self._set_icons()
        self._build_menu_bar()
        self._init_ui()

        sys.stdout = RedirectText(self.console_ctrl)

        self.Centre(wx.BOTH)
        self.Show(True)
        print("Connect your device")
        print("\nIf you chose the serial port auto-select feature you might need to ")
        print("turn off Bluetooth")

    # -----------------------------------------------------------------------
    # UI Event Handlers
    # -----------------------------------------------------------------------
    def on_reload(self, event):
        self.choice.SetItems(self._get_serial_ports())

    def on_baud_changed(self, event):
        radio_button = event.GetEventObject()
        if radio_button.GetValue():
            self._config.baud = radio_button.rate

    def on_mode_changed(self, event):
        radio_button = event.GetEventObject()
        if radio_button.GetValue():
            self._config.mode = radio_button.mode

    def on_erase_changed(self, event):
        radio_button = event.GetEventObject()
        if radio_button.GetValue():
            self._config.erase_before_flash = radio_button.erase

    def on_flash_clicked(self, event):
        if not self._config.is_complete():
            wx.MessageBox("Firmware or Serial Port not selected.", "Error", wx.OK | wx.ICON_ERROR)
            return
        self.console_ctrl.SetValue("")
        worker = FlashingThread(self, self._config)
        worker.start()

    def on_select_port(self, event):
        choice = event.GetEventObject()
        self._config.port = choice.GetString(choice.GetSelection())

    def on_pick_file(self, event):
        self._config.firmware_path = event.GetPath().replace("'", "")

    def on_hover_panel(self, event):
        if self.info_popup_window:
            self.info_popup_window.Dismiss()
            self.info_popup_window = None
        event.Skip()

    def on_hover_info_icon(self, event):
        if not self.info_popup_window:
            from HtmlPopupTransientWindow import HtmlPopupTransientWindow
            win = HtmlPopupTransientWindow(self, wx.SIMPLE_BORDER, __flash_help__, "#FFB6C1", (410, 140))
            
            image = event.GetEventObject()
            image_position = image.ClientToScreen((0, 0))
            image_size = image.GetSize()
            win.Position(image_position, (0, image_size[1]))
            win.Popup()
            self.info_popup_window = win
        event.Skip()

    # -----------------------------------------------------------------------
    # UI Construction Methods
    # -----------------------------------------------------------------------
    def _init_ui(self):
        """Initializes the main UI layout."""
        panel = wx.Panel(self)
        panel.Bind(wx.EVT_MOTION, self.on_hover_panel)

        # Create components by calling the new methods
        serial_sizer = self._create_serial_widgets(panel)
        file_picker = self._create_firmware_widgets(panel)
        baud_sizer, mode_sizer, erase_sizer = self._create_option_widgets(panel)
        flash_button = wx.Button(panel, -1, "Flash NodeMCU")
        flash_button.Bind(wx.EVT_BUTTON, self.on_flash_clicked)
        self.console_ctrl = self._create_console_widget(panel)

        # Assemble the main layout
        main_layout = self._create_main_layout(
            panel, serial_sizer, file_picker, baud_sizer,
            mode_sizer, erase_sizer, flash_button
        )
        panel.SetSizer(main_layout)

    def _create_serial_widgets(self, parent):
        """Creates the controls related to the serial port."""
        self.choice = wx.Choice(parent, choices=self._get_serial_ports())
        self.choice.Bind(wx.EVT_CHOICE, self.on_select_port)
        self._select_configured_port()

        reload_button = wx.Button(parent, label="Reload")
        reload_button.Bind(wx.EVT_BUTTON, self.on_reload)
        reload_button.SetToolTip("Reload serial device list")

        serial_boxsizer = wx.BoxSizer(wx.HORIZONTAL)
        serial_boxsizer.Add(self.choice, 1, wx.EXPAND)
        serial_boxsizer.Add(reload_button, flag=wx.LEFT, border=10)
        return serial_boxsizer

    def _create_firmware_widgets(self, parent):
        """Creates the file picker for the firmware."""
        file_picker = wx.FilePickerCtrl(parent, style=wx.FLP_USE_TEXTCTRL)
        file_picker.Bind(wx.EVT_FILEPICKER_CHANGED, self.on_pick_file)
        return file_picker

    def _create_option_widgets(self, parent):
        """Creates the radio buttons for baud, mode, and erase options."""
        # Baud Rate
        baud_boxsizer = wx.BoxSizer(wx.HORIZONTAL)
        for idx, rate in enumerate(__supported_baud_rates__):
            self._add_radio_button(parent, baud_boxsizer, "baud", rate, str(rate), self._config.baud, self.on_baud_changed, is_first=(idx==0))

        # Flash Mode
        flashmode_boxsizer = wx.BoxSizer(wx.HORIZONTAL)
        modes = [("qio", "Quad I/O (QIO)"), ("dio", "Dual I/O (DIO)"), ("dout", "Dual Output (DOUT)")]
        for idx, (mode, label) in enumerate(modes):
            self._add_radio_button(parent, flashmode_boxsizer, "mode", mode, label, self._config.mode, self.on_mode_changed, is_first=(idx==0))
            
        # Erase Flash
        erase_boxsizer = wx.BoxSizer(wx.HORIZONTAL)
        erases = [(False, "no"), (True, "yes, wipes all data")]
        for idx, (erase_val, label) in enumerate(erases):
             self._add_radio_button(parent, erase_boxsizer, "erase", erase_val, label, self._config.erase_before_flash, self.on_erase_changed, is_first=(idx==0))

        return baud_boxsizer, flashmode_boxsizer, erase_boxsizer

    def _add_radio_button(self, parent, sizer, name, value, label, config_value, handler, is_first=False):
        """Helper to create and add a radio button."""
        style = wx.RB_GROUP if is_first else 0
        radio_button = wx.RadioButton(parent, name=f"{name}-{value}", label=label, style=style)
        
        # Store value in a generic way
        if name == 'baud': radio_button.rate = value
        elif name == 'mode': radio_button.mode = value
        elif name == 'erase': radio_button.erase = value

        radio_button.SetValue(value == config_value)
        radio_button.Bind(wx.EVT_RADIOBUTTON, handler)
        sizer.Add(radio_button)
        sizer.AddSpacer(10)
        
    def _create_console_widget(self, parent):
        """Creates the console text control."""
        console_ctrl = wx.TextCtrl(parent, style=wx.TE_MULTILINE | wx.TE_READONLY | wx.HSCROLL)
        console_ctrl.SetFont(wx.Font((0, 13), wx.FONTFAMILY_TELETYPE, wx.FONTSTYLE_NORMAL, wx.FONTWEIGHT_NORMAL))
        console_ctrl.SetBackgroundColour(wx.WHITE)
        console_ctrl.SetForegroundColour(wx.BLUE)
        return console_ctrl
    
    def _create_main_layout(self, parent, serial_sizer, file_picker, baud_sizer, mode_sizer, erase_sizer, flash_button):
        """Assembles all the widgets into the main layout sizer."""
        fgs = wx.FlexGridSizer(7, 2, 10, 10)

        # Labels
        port_label = wx.StaticText(parent, label="Serial port")
        file_label = wx.StaticText(parent, label="NodeMCU firmware")
        baud_label = wx.StaticText(parent, label="Baud rate")
        erase_label = wx.StaticText(parent, label="Erase flash")
        console_label = wx.StaticText(parent, label="Console")
        
        # Flash Mode Label with Info Icon
        flashmode_label = wx.StaticText(parent, label="Flash mode")
        info_icon = wx.StaticBitmap(parent, wx.ID_ANY, images.Info.GetBitmap())
        info_icon.Bind(wx.EVT_MOTION, self.on_hover_info_icon)
        flashmode_label_boxsizer = wx.BoxSizer(wx.HORIZONTAL)
        flashmode_label_boxsizer.Add(flashmode_label, 1, wx.EXPAND)
        flashmode_label_boxsizer.AddStretchSpacer(0)
        flashmode_label_boxsizer.Add(info_icon)

        # Add all items to the grid sizer
        fgs.AddMany([
            port_label, (serial_sizer, 1, wx.EXPAND),
            file_label, (file_picker, 1, wx.EXPAND),
            baud_label, baud_sizer,
            flashmode_label_boxsizer, mode_sizer,
            erase_label, erase_sizer,
            (wx.StaticText(parent, label="")), (flash_button, 1, wx.EXPAND),
            console_label, (self.console_ctrl, 1, wx.EXPAND)
        ])
        
        fgs.AddGrowableRow(6, 1)
        fgs.AddGrowableCol(1, 1)

        hbox = wx.BoxSizer(wx.HORIZONTAL)
        hbox.Add(fgs, proportion=1, flag=wx.ALL | wx.EXPAND, border=15)
        return hbox

    # -----------------------------------------------------------------------
    # Helper & Other Methods
    # -----------------------------------------------------------------------
    def _select_configured_port(self):
        for i, item in enumerate(self.choice.GetItems()):
            if item == self._config.port:
                self.choice.SetSelection(i)
                break

    @staticmethod
    def _get_serial_ports():
        ports = [f"{__auto_select__} {__auto_select_explanation__}"]
        ports.extend(port for port, desc, hwid in sorted(list_ports.comports()))
        return ports

    def _set_icons(self):
        self.SetIcon(images.Icon.GetIcon())

    def _build_status_bar(self):
        self.statusBar = self.CreateStatusBar(2, wx.STB_SIZEGRIP)
        self.statusBar.SetStatusWidths([-2, -1])
        status_text = f"Welcome to NodeMCU PyFlasher {__version__}"
        self.statusBar.SetStatusText(status_text, 0)

    def _build_menu_bar(self):
        self.menuBar = wx.MenuBar()
        # File menu
        file_menu = wx.Menu()
        wx.App.SetMacExitMenuItemId(wx.ID_EXIT)
        exit_item = file_menu.Append(wx.ID_EXIT, "E&xit\tCtrl-Q", "Exit NodeMCU PyFlasher")
        exit_item.SetBitmap(images.Exit.GetBitmap())
        self.Bind(wx.EVT_MENU, self._on_exit_app, exit_item)
        self.menuBar.Append(file_menu, "&File")
        # Help menu
        help_menu = wx.Menu()
        help_item = help_menu.Append(wx.ID_ABOUT, '&About NodeMCU PyFlasher', 'About')
        self.Bind(wx.EVT_MENU, self._on_help_about, help_item)
        self.menuBar.Append(help_menu, '&Help')
        self.SetMenuBar(self.menuBar)

    @staticmethod
    def _get_config_file_path():
        return os.path.join(wx.StandardPaths.Get().GetUserConfigDir(), "nodemcu-pyflasher.json")

    def _on_exit_app(self, event):
        self._config.safe(self._get_config_file_path())
        self.Close(True)

    def _on_help_about(self, event):
        from About import AboutDlg
        about = AboutDlg(self)
        about.ShowModal()
        about.Destroy()

    def report_error(self, message):
        self.console_ctrl.SetValue(message)

# ---------------------------------------------------------------------------
class MySplashScreen(wx.adv.SplashScreen):
    def __init__(self):
        wx.adv.SplashScreen.__init__(self, images.Splash.GetBitmap(),
                                      wx.adv.SPLASH_CENTRE_ON_SCREEN | wx.adv.SPLASH_TIMEOUT, 2500, None, -1)
        self.Bind(wx.EVT_CLOSE, self._on_close)
        self.__fc = wx.CallLater(2000, self._show_main)

    def _on_close(self, evt):
        evt.Skip()
        self.Hide()
        if self.__fc.IsRunning():
            self.__fc.Stop()
            self._show_main()

    def _show_main(self):
        frame = NodeMcuFlasher(None, "NodeMCU PyFlasher")
        frame.Show()
        if self.__fc.IsRunning():
            self.Raise()

# ---------------------------------------------------------------------------
class App(wx.App, wx.lib.mixins.inspection.InspectionMixin):
    def OnInit(self):
        self.ResetLocale()
        wx.SystemOptions.SetOption("mac.window-plain-transition", 1)
        self.SetAppName("NodeMCU PyFlasher")
        splash = MySplashScreen()
        splash.Show()
        return True

# ---------------------------------------------------------------------------
def main():
    app = App(False)
    app.MainLoop()

# ---------------------------------------------------------------------------
if __name__ == '__main__':
    __name__ = 'Main'
    main()