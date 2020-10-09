'use strict';

const { app, BrowserWindow, clipboard, dialog, shell, Menu } = require('electron');
const { appConfig } = require('./app-config');
const { checkForUpdates } = require('./update-manager');
const { getDateStr } = require('./date-aux.js');
const {
    getSavedPreferences,
    setAlreadyAskedForFlexibleDbMigration,
    getAlreadyAskedForFlexibleDbMigration
} = require('./saved-preferences.js');
const { importDatabaseFromFile, exportDatabaseToFile, migrateFixedDbToFlexible } = require('./import-export.js');
const { notify } = require('./notification');
const os = require('os');
const { savePreferences } = require('./user-preferences.js');
const path = require('path');
const Store = require('electron-store');
const i18n = require('../src/configs/i18next.config');
let { waiverWindow, prefWindow } = require('./windows');

function migrateFixedDbToFlexibleRequest(mainWindow, options)
{
    let response = dialog.showMessageBoxSync(BrowserWindow.getFocusedWindow(), options);
    if (response === 1)
    {
        const migrateResult = migrateFixedDbToFlexible();
        mainWindow.webContents.executeJavaScript('calendar.reload()');
        if (migrateResult)
        {
            Menu.getApplicationMenu().getMenuItemById('migrate-to-flexible-calendar').enabled = false;
            dialog.showMessageBox(BrowserWindow.getFocusedWindow(),
                {
                    title: 'Time to Leave',
                    message: i18n.t('$Menu.Database migrated'),
                    type: 'info',
                    icon: appConfig.iconpath,
                    detail: i18n.t('$Menu.Yay! Migration successful!')
                });
        }
        else
        {
            dialog.showMessageBoxSync({
                type: 'warning',
                title: i18n.t('$Menu.Failed migrating'),
                message: i18n.t('$Menu.Something wrong happened :(')
            });
        }
    }
}

function enableMigrationToFlexibleButton()
{
    const store = new Store();
    const flexibleStore = new Store({name: 'flexible-store'});
    return store.size !== 0 && flexibleStore.size === 0;
}

function getMainMenuTemplate(mainWindow)
{
    return [
        {
            label: i18n.t('$Menu.Workday Waiver Manager'),
            id: 'workday-waiver-manager',
            click(item, window, event)
            {
                if (waiverWindow !== null)
                {
                    waiverWindow.show();
                    return;
                }

                if (event)
                {
                    const today = new Date();
                    global.waiverDay = getDateStr(today);
                }
                const htmlPath = path.join('file://', __dirname, '../src/workday-waiver.html');
                waiverWindow = new BrowserWindow({ width: 600,
                    height: 500,
                    parent: mainWindow,
                    resizable: true,
                    icon: appConfig.iconpath,
                    webPreferences: {
                        enableRemoteModule: true,
                        nodeIntegration: true
                    } });
                waiverWindow.setMenu(null);
                waiverWindow.loadURL(htmlPath);
                waiverWindow.show();
                waiverWindow.on('close', function()
                {
                    waiverWindow = null;
                    mainWindow.webContents.send('WAIVER_SAVED');
                });
            },
        },
        {type: 'separator'},
        {
            label:i18n.t('$Menu.Exit'),
            accelerator: appConfig.macOS ? 'CommandOrControl+Q' : 'Control+Q',
            click()
            {
                app.quit();
            }
        }
    ];
}

function getContextMenuTemplate(mainWindow)
{
    return [
        {
            label: i18n.t('$Menu.Punch time'), click: function()
            {
                let now = new Date();

                mainWindow.webContents.executeJavaScript('calendar.punchDate()');
                // Slice keeps "HH:MM" part of "HH:MM:SS GMT+HHMM (GMT+HH:MM)" time string
                notify(`${i18n.t('$Menu.Punched time')} ${now.toTimeString().slice(0,5)}`);
            }
        },
        {
            label: i18n.t('$Menu.Show App'), click: function()
            {
                mainWindow.show();
            }
        },
        {
            label: i18n.t('$Menu.Quit'), click: function()
            {
                app.quit();
            }
        }
    ];
}

function getDockMenuTemplate(mainWindow)
{
    return [
        {
            label: i18n.t('$Menu.Punch time'), click: function()
            {
                let now = new Date();

                mainWindow.webContents.executeJavaScript('calendar.punchDate()');
                // Slice keeps "HH:MM" part of "HH:MM:SS GMT+HHMM (GMT+HH:MM)" time string
                notify(`${i18n.t('$Menu.Punched time')} ${now.toTimeString().slice(0,5)}`);
            }
        }
    ];
}

function getEditMenuTemplate(mainWindow)
{
    return [
        {
            label: i18n.t('$Menu.Cut'),
            accelerator: 'Command+X',
            selector: 'cut:'
        },
        {
            label: i18n.t('$Menu.Copy'),
            accelerator: 'Command+C',
            selector: 'copy:'
        },
        {
            label: i18n.t('$Menu.Paste'),
            accelerator: 'Command+V',
            selector: 'paste:'
        },
        {
            label: i18n.t('$Menu.Select All'),
            accelerator: 'Command+A',
            selector: 'selectAll:'
        },
        {type: 'separator'},
        {
            label: i18n.t('$Menu.Preferences'),
            accelerator: appConfig.macOS ? 'Command+,' : 'Control+,',
            click()
            {
                if (prefWindow !== null)
                {
                    prefWindow.show();
                    return;
                }

                const htmlPath = path.join('file://', __dirname, '../src/preferences.html');
                prefWindow = new BrowserWindow({ width: 450,
                    height: 600,
                    parent: mainWindow,
                    resizable: true,
                    icon: appConfig.iconpath,
                    webPreferences: {
                        enableRemoteModule: true,
                        nodeIntegration: true
                    } });
                prefWindow.setMenu(null);
                prefWindow.loadURL(htmlPath);
                prefWindow.show();
                prefWindow.on('close', function()
                {
                    prefWindow = null;
                    let savedPreferences = getSavedPreferences();
                    if (savedPreferences !== null)
                    {
                        savePreferences(savedPreferences);
                        mainWindow.webContents.send('PREFERENCE_SAVED', savedPreferences);
                    }

                    const store = new Store();
                    const flexibleStore = new Store({name: 'flexible-store'});

                    if (!getAlreadyAskedForFlexibleDbMigration() &&
                        savedPreferences && savedPreferences['number-of-entries'] === 'flexible' &&
                        store.size !== 0 && flexibleStore.size === 0)
                    {
                        setAlreadyAskedForFlexibleDbMigration(true);
                        const options = {
                            type: 'question',
                            buttons: [i18n.t('$Menu.Cancel'), i18n.t('$Menu.Yes, please'), i18n.t('$Menu.No, thanks')],
                            defaultId: 2,
                            title: i18n.t('$Menu.Migrate fixed calendar database to flexible'),
                            message: i18n.t('$Menu.Your flexible calendar is empty. Do you want to start by migrating the existing fixed calendar database to your flexible one?'),
                        };

                        migrateFixedDbToFlexibleRequest(mainWindow, options);
                    }
                });
            },
        },
        {type: 'separator'},
        {
            label: i18n.t('$Menu.Migrate to flexible calendar'),
            id: 'migrate-to-flexible-calendar',
            enabled: enableMigrationToFlexibleButton(),
            click()
            {
                const options = {
                    type: 'question',
                    buttons: [i18n.t('$Menu.Cancel'), i18n.t('$Menu.Yes, please'), i18n.t('$Menu.No, thanks')],
                    defaultId: 2,
                    title: i18n.t('$Menu.Migrate fixed calendar database to flexible'),
                    message: i18n.t('$Menu.Are you sure you want to migrate the fixed calendar database to the flexible calendar?\n\nThe existing flexible calendar database will be cleared.'),
                };

                migrateFixedDbToFlexibleRequest(mainWindow, options);
            },
        },
        {type: 'separator'},
        {
            label: i18n.t('$Menu.Export database'),
            click()
            {
                let options = {
                    title: i18n.t('$Menu.Export DB to file'),
                    defaultPath : 'time_to_leave',
                    buttonLabel : i18n.t('$Menu.Export'),

                    filters : [
                        { name: '.ttldb', extensions: ['ttldb',] },
                        { name: i18n.t('$Menu.All Files'), extensions: ['*'] }
                    ]
                };
                let response = dialog.showSaveDialogSync(options);
                if (response)
                {
                    exportDatabaseToFile(response);
                    dialog.showMessageBox(BrowserWindow.getFocusedWindow(),
                        {
                            title: 'Time to Leave',
                            message: i18n.t('$Menu.Database export'),
                            type: 'info',
                            icon: appConfig.iconpath,
                            detail: i18n.t('$Menu.Okay, database was exported.')
                        });
                }
            },
        },
        {
            label: i18n.t('$Menu.Import database'),
            click()
            {
                let options = {
                    title: i18n.t('$Menu.Import DB from file'),
                    buttonLabel : i18n.t('$Menu.Import'),

                    filters : [
                        {name: '.ttldb', extensions: ['ttldb',]},
                        {name: i18n.t('$Menu.All Files'), extensions: ['*']}
                    ]
                };
                let response = dialog.showOpenDialogSync(options);
                if (response)
                {
                    const options = {
                        type: 'question',
                        buttons: [i18n.t('$Menu.Yes, please'), i18n.t('$Menu.No, thanks')],
                        defaultId: 2,
                        title: i18n.t('$Menu.Import database'),
                        message: i18n.t('$Menu.Are you sure you want to import a database? It will override any current information.'),
                    };

                    let confirmation = dialog.showMessageBoxSync(BrowserWindow.getFocusedWindow(), options);
                    if (confirmation === /*Yes*/0)
                    {
                        const importResult = importDatabaseFromFile(response);
                        // Reload only the calendar itself to avoid a flash
                        mainWindow.webContents.executeJavaScript('calendar.reload()');
                        if (importResult['result'])
                        {
                            dialog.showMessageBox(BrowserWindow.getFocusedWindow(),
                                {
                                    title: 'Time to Leave',
                                    message: i18n.t('$Menu.Database imported'),
                                    type: 'info',
                                    icon: appConfig.iconpath,
                                    detail: i18n.t('$Menu.Yay! Import successful!')
                                });
                        }
                        else if (importResult['failed'] !== 0)
                        {
                            if (importResult['failed'] !== 0)
                            {
                                const message = `${importResult['failed']}/${importResult['total']} ${i18n.t('$Menu.could not be loaded')}`;
                                dialog.showMessageBoxSync({
                                    icon: appConfig.iconpath,
                                    type: 'warning',
                                    title: i18n.t('$Menu.Failed entries'),
                                    message: message
                                });
                            }
                        }
                        else
                        {
                            dialog.showMessageBoxSync({
                                icon: appConfig.iconpath,
                                type: 'warning',
                                title: i18n.t('$Menu.Failed entries'),
                                message: i18n.t('$Menu.Something wrong happened')
                            });
                        }
                    }
                }
            },
        },
        {
            label: i18n.t('$Menu.Clear database'),
            click()
            {
                const options = {
                    type: 'question',
                    buttons: [i18n.t('$Menu.Cancel'), i18n.t('$Menu.Yes, please'), i18n.t('$Menu.No, thanks')],
                    defaultId: 2,
                    title: i18n.t('$Menu.Clear database'),
                    message: i18n.t('$Menu.Are you sure you want to clear all the data?'),
                };

                let response = dialog.showMessageBoxSync(BrowserWindow.getFocusedWindow(), options);
                if (response === 1)
                {
                    const store = new Store();
                    const waivedWorkdays = new Store({name: 'waived-workdays'});
                    const flexibleStore = new Store({name: 'flexible-store'});

                    store.clear();
                    waivedWorkdays.clear();
                    flexibleStore.clear();
                    // Reload only the calendar itself to avoid a flash
                    mainWindow.webContents.executeJavaScript('calendar.reload()');
                    dialog.showMessageBox(BrowserWindow.getFocusedWindow(),
                        {
                            title: 'Time to Leave',
                            message: i18n.t('$Menu.Clear Database'),
                            type: 'info',
                            icon: appConfig.iconpath,
                            detail: `\n${i18n.t('$Menu.All cleared!')}`
                        });
                }
            }
        },
    ];
}

function getViewMenuTemplate()
{
    return [
        {
            label: i18n.t('$Menu.Reload'),
            accelerator: 'CommandOrControl+R',
            click()
            {
                BrowserWindow.getFocusedWindow().reload();
            }
        },
        {
            label: i18n.t('$Menu.Toggle Developer Tools'),
            accelerator: appConfig.macOS ? 'Command+Alt+I' : 'Control+Shift+I',
            click()
            {
                BrowserWindow.getFocusedWindow().toggleDevTools();
            }
        }
    ];
}

function getHelpMenuTemplate()
{
    return [
        {
            label: i18n.t('$Menu.TTL GitHub'),
            click()
            {
                shell.openExternal('https://github.com/thamara/time-to-leave');
            }
        },
        {
            label: i18n.t('$Menu.Check for updates'),
            click()
            {
                checkForUpdates(/*showUpToDateDialog=*/true);
            }
        },
        {
            label: i18n.t('$Menu.Send feedback'),
            click()
            {
                shell.openExternal('https://github.com/thamara/time-to-leave/issues/new');
            }
        },
        {
            type: 'separator'
        },
        {
            label: i18n.t('$Menu.About'),
            click()
            {
                const version = app.getVersion();
                const electronVersion = process.versions.electron;
                const chromeVersion = process.versions.chrome;
                const nodeVersion = process.versions.node;
                const OSInfo = `${os.type()} ${os.arch()} ${os.release()}`;
                const detail = `Version: ${version}\nElectron: ${electronVersion}\nChrome: ${chromeVersion}\nNode.js: ${nodeVersion}\nOS: ${OSInfo}`;
                dialog.showMessageBox(BrowserWindow.getFocusedWindow(),
                    {
                        title: 'Time to Leave',
                        message: 'Time to Leave',
                        type: 'info',
                        icon: appConfig.iconpath,
                        detail: `\n${detail}`,
                        buttons: [i18n.t('$Menu.Copy'), i18n.t('$Menu.OK')],
                        noLink: true
                    }
                ).then((result) =>
                {
                    const buttonId = result.response;
                    if (buttonId === 0)
                    {
                        clipboard.writeText(detail);
                    }
                }).catch(err =>
                {
                    console.log(err);
                });
            }
        }
    ];
}

module.exports = {
    getContextMenuTemplate,
    getDockMenuTemplate,
    getEditMenuTemplate,
    getHelpMenuTemplate,
    getMainMenuTemplate,
    getViewMenuTemplate
};
