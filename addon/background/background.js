/* globals ACTION Downloads Options Global Version */

// Import for testing
if (typeof module !== "undefined") {
  const d = require("background/downloads");
  window.Downloads = d.Downloads;
  const g = require("background/global");
  window.Global = g.Global;
  const v = require("background/version");
  window.Version = v.Version;
}

async function getWindowId() {
  const mywindow = await browser.windows.getCurrent();
  console.debug("Window", mywindow);
  return mywindow.id;
}

class AppCancelled extends Error {}

const App = {
  constants: {
    contentScript: "/content/get-images.js",
    icon: "" // icon used on notifications
  },
  options: {},
  runtime: new Map(),
  blocking: new Map(),
  loadedManifest: false,
  reload: false,

  getRuntime: (windowId) => {
    const props = App.runtime.get(windowId);
    if (props) {
      return props;
    }
    throw new Error("runtime not found");
  },

  // window is idle, all downloads ended
  isFinished: (windowId) => !App.runtime.has(windowId),

  // cancel has been triggered but not finished
  isCancelled: (windowId) => App.getRuntime(windowId).cancel,

  // is in run() function
  isRunning: (windowId) => App.blocking.has(windowId),

  // all windows idle
  isIdle: () => App.runtime.size === 0,

  addUrl: (url, windowId) => App.getRuntime(windowId).urls.add(url),

  // is valid if not duplicate
  isUniqueUrl: (url, windowId) => !App.getRuntime(windowId).urls.has(url),

  setTitle: async () => {
    const title = browser.i18n.getMessage("browser_action_tooltip", browser.i18n.getMessage(`options_action_label_${App.options.action}`));
    await browser.browserAction.setTitle({title});
  },

  setupBadge: () => {
    /*
    if (App.runtime && App.runtime.badgeTimeout) {
      clearTimeout(App.runtime.badgeTimeout);
    }
    */
  },

  hideBadge: () => {
    /*
    App.runtime.badgeTimeout = setTimeout(() => {
    browser.browserAction.setBadgeText({text: ""});
    }, 60*1000);
    */
  },

  setBadgeText: (details) => {
    try {
      browser.browserAction.setBadgeText(details);
    } catch (err) {
      // if cannot set windowId then use tabId
      if (details.windowId) {
        const tabId = App.getRuntime(details.windowId).tabId;
        delete details.windowId;
        details.tabId = tabId;
        App.setBadgeText(details);
      }
    }
  },

  setBadgeBackgroundColor: (details) => {
    try {
      browser.browserAction.setBadgeBackgroundColor(details);
    } catch (err) {
      // if cannot set windowId then use tabId
      if (details.windowId) {
        const tabId = App.getRuntime(details.windowId).tabId;
        delete details.windowId;
        details.tabId = tabId;
        App.setBadgeBackgroundColor(details);
      }
    }
  },

  setBadgeFinished: (windowId) => {
    const num = App.getRuntime(windowId).imagesSaved;
    let color = "#579900d0"; // green
    if (App.getRuntime(windowId).imagesFailed > 0 ||
      App.getRuntime(windowId).pathsFailed > 0) {
      color = "#d3290fd0"; // red
    } else if (App.getRuntime(windowId).imagesSaved === 0) {
      color = "#cc9a23d0"; // yellow
    }
    App.setBadgeText({text: num.toString(), windowId});
    App.setBadgeBackgroundColor({color, windowId});
    App.hideBadge();
  },

  setBadgeSaving: (windowId) => {
    const num = App.getRuntime(windowId).imagesSaved;
    if (num > 0) {
      App.setBadgeText({text: num.toString(), windowId});
      App.setBadgeBackgroundColor({color: "#486fe3d0", windowId}); // blue
    }
  },

  setBadgeLoading: (windowId, percent = undefined) => {
    let text = "";
    if (percent !== undefined) {
      const icons = "○◔◑◕●";
      const x = Math.round(percent / 100 * 4);
      text = icons.charAt(x);
    } else {
      const icons = "◷◶◵◴";
      let num = App.getRuntime(windowId).badgeLoading;
      text = icons.charAt(num);
      num++;
      if (num > 3) {
        num = 0;
      }
      App.getRuntime(windowId).badgeLoading = num;
    }
    App.setBadgeText({text, windowId});
    App.setBadgeBackgroundColor({color: "#8b67b3d0", windowId}); // purple
  },

  notify: async (id, message) => {
    if (!App.options.notifyEnded) {
      return null;
    }
    try {
      const obj = {
        "type": "basic",
        "iconUrl": browser.extension.getURL(App.constants.icon)
      };
      for (const prop in message) {
        if ({}.propertyIsEnumerable.call(message, prop)) {
          obj[prop] = message[prop];
        }
      }
      return await browser.notifications.create(id, obj);
    } catch (err) {
      console.error("Note failed:", err); /* RemoveLogging:skip */
    }
    return false;
  },

  notifyFinished: (windowId) => {
    App.setBadgeFinished(windowId);
    let msgErr = "";
    const tabsError = App.getRuntime(windowId).tabsError;
    if (tabsError > 0) {
      if (App.options.action === ACTION.ACTIVE) {
        msgErr = browser.i18n.getMessage("notification_content_permission_error_active");
      } else {
        msgErr = browser.i18n.getMessage("notification_content_permission_error_tabs", tabsError);
      }
    }
    let msg = "";
    let title = browser.i18n.getMessage("notification_title_finished");
    if (App.isCancelled(windowId)) {
      title = browser.i18n.getMessage("notification_title_cancelled");
      msg += browser.i18n.getMessage("notification_content_cancelled");
      msg += "\n";
    }
    if (App.getRuntime(windowId).tabsLoaded === 0) {
      msg += browser.i18n.getMessage("notification_content_no_tabs",
        browser.i18n.getMessage(`options_action_label_${App.options.action}`));
      msg += `\n${msgErr}`;
      App.notify(`finished_${windowId}`, {
        title,
        message: msg
      });
      return;
    }
    const imagesSaved = App.getRuntime(windowId).imagesSaved;
    const imagesFailed = App.getRuntime(windowId).imagesFailed;
    const pathsFailed = App.getRuntime(windowId).pathsFailed;
    console.log(`${imagesSaved} Saved, ${imagesFailed} Failed`);
    if (imagesSaved === 0 &&
      imagesFailed === 0 &&
      pathsFailed === 0) {
      msg += browser.i18n.getMessage("notification_content_no_images");
    } else {
      if (imagesSaved > 0) {
        msg += browser.i18n.getMessage("notification_content_images_saved", imagesSaved);
        msg += "\n";
      }
      if (imagesFailed > 0) {
        msg += browser.i18n.getMessage("notification_content_images_failed", imagesFailed);
        msg += "\n";
      }
      if (pathsFailed > 0) {
        msg += browser.i18n.getMessage("notification_content_paths_failed", pathsFailed);
        msg += "\n";
      }
    }
    msg += "\n";
    // if (App.runtime.tabsSkipped > 0) {
    //  msg += `${App.runtime.tabsSkipped} tabs skipped\n`;
    // }
    console.log("Notify finished");
    App.notify(`finished_${windowId}`, {
      title,
      message: `${msg}${msgErr}`
    });
  },

  // cleanup and remove runtime for selected window
  setFinished: (windowId) => {
    App.notifyFinished(windowId);
    // cleanup orphans in Downloads
    Downloads.removeWindowDownloads(windowId);
    App.runtime.delete(windowId); // cleanup
    if (App.isIdle()) {
      browser.downloads.onChanged.removeListener(Downloads.handleDownloadChanged); // remove download listener
      if (App.reload) {
        console.debug("Reloading addon");
        browser.runtime.reload();
      }
    }
  },

  downloadFinished: (windowId) => {
    // guard against same download sending concurrent triggers
    if (!App.isRunning(windowId) && // test app is not in progress
      !App.isFinished(windowId) && // test downloads have finished
      Downloads.hasWindowDownloads(windowId) === false) {
      console.log("window has ended", windowId);
      if (!App.isCancelled(windowId)) {
        App.setFinished(windowId);
      }
    }
  },

  handleDownloadComplete: async (context) => {
    const windowId = context.windowId;
    const tabId = context.tabId;
    App.setBadgeSaving(windowId);
    App.getRuntime(windowId).imagesSaved++;
    if (App.options.closeTab) {
      if (Downloads.hasTabDownloads(tabId) === false) {
        try {
          await browser.tabs.remove(tabId);
          console.log(`Tab removed ${tabId}`);
        } catch (err) {
          console.error(`Failed removing tab ${tabId}:`, err); /* RemoveLogging:skip  */
        }
      }
    }
    App.downloadFinished(windowId);
  },

  handleDownloadFailed: (context) => {
    const windowId = context.windowId;
    App.getRuntime(windowId).imagesFailed++;
    App.downloadFinished(windowId);
  },

  // generate file path from image attributes, index number, and rules template
  // return null if failed
  createFilename: async (image, index, rules) => {
    let xhrLoaded = false;
    const parse = Global.parseURL(image.src); // URI components will be encoded
    const path = decodeURI(parse.pathname);
    // obj properties should be lowercase
    let obj = {
      alt: "",
      ext: Global.getFileExt(path),
      hostname: parse.hostname,
      host: parse.hostname,
      index: index.toString(),
      name: Global.getFilePart(path),
      path: Global.getDirname(path),
      xname: "",
      xext: "",
      xmimeext: ""
    };
    if (image.alt) {
      obj.alt = Global.sanitizeFilename(image.alt);
    }
    for (const rule of rules) {
      // check current rule for XHR variables and load XHR if required
      if (!xhrLoaded && (rule.includes("<x") || rule.includes("|x"))) {
        const hdr = await Global.getHeaderFilename(image.src);
        if (hdr.filename) {
          obj.xname = Global.getFilePart(hdr.filename);
          obj.xext = Global.getFileExt(hdr.filename);
        }
        if (hdr.mimeExt) {
          obj.xmimeext = hdr.mimeExt;
        }
        xhrLoaded = true;
      }
      const filename = Global.template(rule, obj).trim();
      console.debug(`rule: ${rule}, filename: ${filename}, valid: ${Global.isValidPath(filename)}`);
      if (Global.isValidPath(filename)) {
        console.debug("createFilename", rule, filename); /* RemoveLogging: skip */
        return filename;
      }
    }
    return null;
  },

  createPath: async (image, index, rules) => {
    const filename = await App.createFilename(image, index, rules);
    if (filename === null) {
      throw new Error("Unable to generate filename");
    }
    const path = Global.sanitizePath(
      Global.pathJoin([App.options.downloadPath, filename])
    );
    if (!Global.isValidFilename(path)) {
      throw new Error(`Invalid filename generated: ${path}`);
    }
    return path;
  },

  createDownloads: async (tabResults, windowId) => {
    let promiseDownloads = [];
    let index = 1;
    for (const result of tabResults) {
      if (App.isCancelled(windowId)) {
        return promiseDownloads;
      }
      if (result === false) {
        // tab skipped
      } else {
        // tab ended
        const tabId = result[0];
        const images = result[1];
        for (const image of images) {
          if (App.isCancelled(windowId)) {
            return promiseDownloads;
          }
          try {
            const path = await App.createPath(image, index, App.options.pathRules);
            promiseDownloads.push(
              Downloads.startDownload({
                url: image.src,
                filename: path,
                conflictAction: App.options.conflictAction,
                incognito: App.options.removeEnded // min_ver FF57
              }, {
                tabId,
                windowId,
                then: (v) => App.handleDownloadComplete({tabId, windowId}),
                error: (v) => App.handleDownloadFailed({tabId, windowId})
              }));
            index++;
          } catch (err) {
            // unable to generate filename from rules
            console.error(err, image); /* RemoveLogging:skip */
            App.getRuntime(windowId).pathsFailed++;
          }
        }
      }
    }
    return promiseDownloads;
  },

  // return false if no downloads
  downloadTab: async (tabResults, windowId) => {
    // executeTab returns: [tabid, [results]]
    console.log("tabResults", tabResults);
    if (tabResults.length === 0) {
      console.debug("downloadTab:finished");
      return false;
    }
    const promiseDownloads = await App.createDownloads(tabResults, windowId);
    return await Global.allPromises(
      promiseDownloads,
      (downloads) => {
        console.log("downloads", downloads);
        if (downloads.length === 0) {
          // No downloads found, finish immediately
          console.debug("downloadTab:allPromises:finished");
          return false;
        }
        return true;
      },
      (err) => {console.error("downloads", err);}
    );
  },

  // select valid images and remove duplicates
  // return array of images to be downloaded
  filterImages: (images, windowId) => {
    let result = [];
    if (!images) {
      return result;
    }
    for (const image of images) {
      const url = image.src;
      if (url.indexOf("data:") === 0) {
        App.getRuntime(windowId).imagesFailed++;
        // TODO support embedded images
        console.warn("Embedded image is unsupported"); /* RemoveLogging:skip */
      } else if (App.isUniqueUrl(url, windowId) === false) {
        console.log("Duplicate URL skipped", url);
        App.getRuntime(windowId).imagesSkipped++;
      } else {
        App.addUrl(url, windowId);
        console.log("Found image:", url);
        App.getRuntime(windowId).imagesMatched++;
        result.push(image);
      }
    }
    return result;
  },

  executeTab: async (tab, windowId) => {
    if (tab) {
      const tabid = tab.id;
      try {
        console.log(`Sending tab ${tabid}: ${App.constants.contentScript}`, tab);
        // returns array of script result for each loaded tab
        const results = await browser.tabs.executeScript(
          tabid, {
            file: App.constants.contentScript,
            runAt: "document_end" // "document_idle" may block if page is manually stopped
          }
        );
        App.getRuntime(windowId).tabsLoaded++;
        console.log(`Response from tab ${tabid}`, results);
        const images = App.filterImages(results[0], windowId);
        if (images.length > 0) {
          App.getRuntime(windowId).tabsEnded++;
          return [tabid, images];
        }
      } catch (err) {
        App.getRuntime(windowId).tabsError++;
        console.error(`Error executing tab ${tabid}: ${tab.url}`, err); /* RemoveLogging:skip */
        return false;
      }
    }
    App.getRuntime(windowId).tabsSkipped++;
    return false;
  },

  executeTabs: async (tabs, windowId, callback) => {
    let promiseTabs = [];
    for (const tab of tabs) {
      promiseTabs.push(App.executeTab(tab, windowId));
    }
    return await Global.allPromises(
      promiseTabs,
      async (tabResults) => await callback(tabResults, windowId),
      (err) => {
        if (err instanceof AppCancelled) {
          console.debug("executeTabs passed cancelled");
          throw err;
        }
        console.error("executeTabs", err);
      }
    );
  },

  getWindowTabs: (windowId) => browser.tabs.query({windowId}),

  // pass array of objects {index, tab}
  // loops through tabs checking for loaded status
  // refresh tabs if discarded
  // returns object with arrays ready and waiting
  checkTabs: async (objs, windowId) => {
    let ready = [];
    let sleepMore = false;
    let waiting = await objs.reduce(async (aacc, aval) => {
      let waiting = await aacc;
      let tab = aval.tab;
      let index = aval.index;
      if (App.isCancelled(windowId)) {
        throw new AppCancelled("checkTabs");
      }
      // scripts do not run in discarded tabs
      if (tab.discarded) {
        if (App.options.ignoreDiscardedTab) {
          console.log(`Tab ${tab.id} discarded, ignoring:`, tab.url);
          return waiting;
        }
        try {
          console.log(`Tab ${tab.id} discarded, reloading:`, tab.url);
          tab = await browser.tabs.update(tab.id, {url: tab.url}); // reload() does not affect discarded state
        } catch (err) {
          console.debug("cannot reload tab:", tab.url);
          return waiting;
        }
        sleepMore = true;
      }
      if (tab.status === "complete") {
        ready.push({index, tab});
      } else {
        // tab.status === "loading"
        sleepMore = true;
        tab = await browser.tabs.get(tab.id);
        waiting.push({index, tab});
      }
      return waiting;
    },
    []
    );
    return {ready, waiting, sleepMore};
  },

  // wait for all tabs to have status=complete
  // returns array of tabs
  waitForTabs: async (tabs, windowId) => {
    let waiting = tabs.reduce((acc, val, idx) => {
      acc.push({index: idx, tab: val});
      return acc;
    }, []); // add index to entries
    let ready = [];
    let sleepMore = false;
    let loop = 0;
    while (waiting.length > 0) {
      // don't sleep in the first loop
      if (loop > 0 && !await Global.sleepCallback(
        1000,
        (ms, remain) => {
          App.setBadgeLoading(windowId);
          return App.isCancelled(windowId);
        }
      )) {
        throw new AppCancelled("waitForTabs");
      }
      try {
        const ret = await App.checkTabs(waiting, windowId);
        sleepMore = ret.sleepMore;
        ret.ready.reduce((acc, val) => {
          ready[val.index] = val.tab;
          return acc;
        }, []); // assign ready entries to array
        waiting = ret.waiting;
      } catch (err) {
        console.debug("waitForTabs passed", err);
        throw err;
      }
      loop++;
    }
    if (sleepMore) {
      if (!await Global.sleepCallback(
        5000,
        (ms, remain) => {
          const percent = (ms - remain) / ms * 100;
          App.setBadgeLoading(windowId, percent);
          return App.isCancelled(windowId);
        }
      )) {
        throw new AppCancelled("waitForTabs");
      }
    }
    return ready;
  },

  filterTabs: async (method, includeActive, windowId) => {
    let doTab = false;
    let doAfter = false;
    let doCurrent = false;
    switch (method) {
      case ACTION.LEFT:
        doTab = true;
        break;
      case ACTION.RIGHT:
        doAfter = true;
        break;
      case ACTION.ALL:
        doTab = true;
        doAfter = true;
        break;
      case ACTION.ACTIVE:
        doCurrent = true;
        break;
      default:
        throw new Error("Invalid method for filterTabs:", method); /* RemoveLogging:skip */
    }
    let tabsWaiting = [];
    const allTabs = await App.getWindowTabs(windowId);
    if (allTabs.length === 0) {
      return tabsWaiting;
    }
    for (const tab of allTabs) {
      if (tab.active) {
        if (!doAfter) {
          doTab = false;
        } else {
          doTab = true;
          if (!(doCurrent || includeActive)) {
            continue;
          }
        }
      }
      if (doTab || (tab.active && (doCurrent || includeActive))) {
        tabsWaiting.push(tab);
        // promiseTabs.push(App.executeTab(await App.waitForTab(tab)));
      }
      if (tab.active && !doAfter) {
        break;
      }
    }
    // filter tabs without URLs
    tabsWaiting = tabsWaiting.filter((tab) => tab.url.match(/^(https?|ftps?):\/\/.+/) !== null);
    return tabsWaiting;
  },

  getActiveTab: async (windowId) => {
    const ret = await browser.tabs.query({windowId, active: true});
    return ret[0]; // TODO error check
  },

  handleUpdateAvailable: async () => {
    console.debug("Addon update available");
    if (App.isIdle()) {
      browser.runtime.reload();
    } else {
      App.reload = true;
    }
  },

  // load options to trigger onLoad and set commands
  handleInstalled: async () => {
    const mf = await App.loadManifest();
    await Version.update(mf.version);
    await App.init();
  },

  // load options to trigger onLoad and set commands
  init: async () => {
    console.debug("Background.init");
    if (browser.storage.onChanged.hasListener(App.handleStorageChanged)) {
      browser.storage.onChanged.removeListener(App.handleStorageChanged);
    }
    await App.loadManifest(); // will skip if already loaded
    await App.loadOptions();
    browser.storage.onChanged.addListener(App.handleStorageChanged);
  },

  // load manifest.json and apply some fields to constants
  loadManifest: async (reload = false) => {
    if (!App.loadedManifest || reload) {
      const mf = await browser.runtime.getManifest();
      console.log(mf);
      App.constants.icon = mf.icons["48"];
      App.loadedManifest = true;
      return mf;
    }
    return null;
  },

  handleStorageChanged: (changes, area) => {
    console.debug("ReLoading background options");
    App.options = Options.handleStorageChanged(changes, area);
  },

  loadOptions: async () => {
    console.debug("Loading background options");
    App.options = await Options.loadOptions();
    await App.setTitle();
  },

  cancel: async (windowId) => {
    console.info("Cancelling windowId:", windowId);
    if (!App.isFinished(windowId)) {
      App.getRuntime(windowId).cancel = true;
      if (!App.isRunning(windowId)) {
        await Downloads.cancelWindowDownloads(windowId);
        console.debug("cancelWindowDownloads completed");
        App.setFinished(windowId);
      }
    }
  },

  // return (for testing)
  //   -1: run blocked
  //    1: normal completion
  run: async (windowId) => {
    if (App.isRunning(windowId)) {
      console.debug("run blocked");
      return -1; // -1 for testing
    }
    App.blocking.set(windowId);
    const mytab = await App.getActiveTab(windowId);
    const tabId = mytab.id;
    console.debug("running", {windowId, tabId});
    App.setupBadge(); // run before clearing runtime
    browser.downloads.onChanged.addListener(Downloads.handleDownloadChanged);
    App.runtime.set(windowId, {
      tabId, // required for setting badge
      startDate: new Date(),
      tabsLoaded: 0, // tabs executed
      tabsEnded: 0, // tabs returned a message
      tabsSkipped: 0, // tabs with no valid images
      tabsError: 0, // tabs with no permission
      imagesMatched: 0, // valid images
      imagesSkipped: 0, // skipped duplicates
      imagesFailed: 0, // failed downloads
      imagesSaved: 0, // saved images
      pathsFailed: 0, // failed creating path using rules
      badgeTimeout: undefined,
      badgeLoading: 0,
      urls: new Set(), // unique urls for this window's tabs only
      cancel: false
    });
    App.setBadgeLoading(windowId);
    try {
      const tabsWaiting = await App.filterTabs(App.options.action, App.options.activeTab, windowId);
      const tabsReady = await App.waitForTabs(tabsWaiting, windowId);
      const ret = await App.executeTabs(tabsReady, windowId, App.downloadTab);
      console.debug("Run finished", ret);
      if (!ret) {
        // no tabs or downloads found
        App.setFinished(windowId);
      } else if (App.isCancelled(windowId)) {
        await Downloads.cancelWindowDownloads(windowId);
        console.debug("cancelWindowDownloads completed");
        App.setFinished(windowId);
      }
    } catch (err) {
      if (err instanceof AppCancelled) {
        console.debug("Run cancelled in:", err.message);
        // cleanup any lingering downloads
        await Downloads.cancelWindowDownloads(windowId);
        console.debug("cancelWindowDownloads completed");
        App.setFinished(windowId);
      } else {
        console.error("Run:", err);
      }
    }
    App.blocking.delete(windowId);
    return 1; // 1 for testing
  },

  // return (for testing)
  //   -1: run blocked
  //    1: normal completion
  //    2: cancel triggered
  handleBrowserAction: async () => {
    const windowId = await getWindowId();
    if (App.isRunning(windowId) || !App.isFinished(windowId)) {
      await App.cancel(windowId);
      return 2; // 2 for testing
    }
    return App.run(windowId);
  }
};

browser.browserAction.onClicked.addListener(App.handleBrowserAction);
browser.runtime.onInstalled.addListener(App.handleInstalled);
browser.runtime.onUpdateAvailable.addListener(App.handleUpdateAvailable);
browser.runtime.onStartup.addListener(App.init);

// Export for testing
if (typeof module !== "undefined") {
  module.exports = {App, getWindowId};
}
