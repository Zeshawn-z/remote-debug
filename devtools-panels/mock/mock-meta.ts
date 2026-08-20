// Copyright 2024 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as i18n from '../../core/i18n/i18n.js';
import * as UI from '../../ui/legacy/legacy.js';

import type * as Mock from './mock.js';

const UIStrings = {
  /**
   *@description Title of the Mock panel (a chii custom panel that intercepts and mocks network requests)
   */
  mock: 'Mock',
  /**
   *@description Command for showing the Mock panel
   */
  showMock: 'Show Mock',
};
const str_ = i18n.i18n.registerUIStrings('panels/mock/mock-meta.ts', UIStrings);
const i18nLazyString = i18n.i18n.getLazilyComputedLocalizedString.bind(undefined, str_);

let loadedMockModule: (typeof Mock|undefined);

async function loadMockModule(): Promise<typeof Mock> {
  if (!loadedMockModule) {
    loadedMockModule = await import('./mock.js');
  }
  return loadedMockModule;
}

UI.ViewManager.registerViewExtension({
  location: UI.ViewManager.ViewLocationValues.PANEL,
  id: 'mock',
  title: i18nLazyString(UIStrings.mock),
  commandPrompt: i18nLazyString(UIStrings.showMock),
  order: 102,
  async loadView() {
    const Mock = await loadMockModule();
    return Mock.MockPanel.MockPanel.instance();
  },
});
