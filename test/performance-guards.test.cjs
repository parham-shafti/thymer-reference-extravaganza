const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'plugin.js'), 'utf8');

test('learned-alias analysis is demand-driven rather than a startup hydration tax', () => {
  assert.match(source, /if \(self\._aliasManageRecordGuid \|\| self\._lineAliasManageLineGuid\) \{\s*self\._aliasScheduleFrequentScan\(250\);/);
  assert.match(source, /this\._aliasManageRefresh = render;\s*this\._aliasScheduleFrequentScan\(0\);/);
  assert.match(source, /this\._lineAliasManageRefresh = render;\s*this\._aliasScheduleFrequentScan\(0\);/);
});

test('cold event enrichment and learned-alias folding have cooperative yield guards', () => {
  assert.match(source, /coldEnrichRunning = true;/);
  assert.match(source, /processed % 64 !== 0 \|\| Date\.now\(\) - sliceStartedAt < 8/);
  assert.match(source, /processed % 128 === 0 && Date\.now\(\) - sliceStartedAt >= 8/);
});

test('reference hydration seeds all record identities before property-edge classification', () => {
  const hydration = source.slice(source.indexOf('    const startHydration = async (backgroundGeneration) => {'), source.indexOf('    // Kick off hydration.'));
  const seed = hydration.indexOf('self._markRecordTargetKnown(recGuid)');
  const edgeBuild = hydration.indexOf('self._edgesFromRecord(rec, colGuid, wsGuid, lineRefPropNames)');
  assert.ok(seed >= 0, 'hydration must pre-seed the native record identity set');
  assert.ok(edgeBuild > seed, 'property targets must be classified only after record identity seeding');
  assert.match(hydration, /const collectionSnapshots = \[\];/);
  assert.match(hydration, /for \(const snapshot of collectionSnapshots\)/);
  assert.doesNotMatch(hydration, /getLineItems\(/, 'startup hydration must never walk every record body');
  assert.match(source, /supportsScopedHydration: true/);
  assert.match(source, /const ensureTarget = async/);
  assert.match(source, /const ensureSource = async/);
});

test('runtime and manifest versions identify the current release', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin.json'), 'utf8'));
  assert.equal(manifest.version, '4.64.1');
  assert.ok(source.startsWith('// v4.64.1'), 'first line must be // v4.64.1');
  assert.match(source, /window\.__REFX_VERSION = "4\.64\.1"/);
});

test('reference expansion avoids whole-body probes and broad record-update discovery', () => {
  const bodyProbe = source.slice(source.indexOf('  _applyBodyEmptyLater('), source.indexOf('// Where a card is inserted'));
  assert.doesNotMatch(bodyProbe, /\w+\.getLineItems\s*\(/);
  const refresh = source.slice(source.indexOf('  _refreshCardInPlace('), source.indexOf('  // Give an empty record'));
  assert.doesNotMatch(refresh, /\w+\.getLineItems\s*\(/);
  const recordUpdated = source.slice(source.indexOf('_onRecordUpdated(ev)'), source.indexOf('_onRecordMoved(ev)'));
  assert.doesNotMatch(recordUpdated, /_scheduleDiscover\s*\(/);
  assert.match(source, /btn\.click\(\);/);
});

test('record refs preview without a native body; line refs stay native', () => {
  const expand = source.slice(source.indexOf('  async _expandRef('), source.indexOf('  // Collapse the embed'));
  const previewBranch = expand.indexOf('if (!ref.isText && options.forceTransclusion !== true)');
  const nativeCreate = expand.indexOf('rec.createLineItem(block, null, "transclusion"');
  assert.ok(previewBranch >= 0 && nativeCreate > previewBranch, 'record preview branch must precede native transclusion creation');
  assert.match(expand, /if \(!ref\.isText && options\.forceTransclusion !== true\) \{[\s\S]*?return await this\._openRecordPreview\(block, ref\.targetGuid, hit\.lineGuid\);/);
  const previewOpen = source.slice(source.indexOf('  async _openRecordPreview('), source.indexOf('  async _materializeRecordPreview('));
  assert.match(previewOpen, /_writeRecordPreviewMeta\(block, targetGuid, true\)/);
  const materialize = source.slice(source.indexOf('  async _materializeRecordPreview('), source.indexOf('  // Expand:'));
  assert.match(materialize, /rec\.createLineItem\(block, null, "transclusion"/);
  assert.match(materialize, /if \(!\(await this\._writeRecordPreviewMeta\(block, entry\.targetGuid, false\)\)\) \{[\s\S]*?_rollbackCreatedTransclusion/);
  assert.doesNotMatch(materialize, /_cardFieldsCache\.delete\(entry\.targetGuid\)/);
  assert.doesNotMatch(materialize, /_renderFreshCard\(line\.guid, entry\.targetGuid/);
  const freshCard = source.slice(source.indexOf('  async _renderFreshCard('), source.indexOf('  // Resolve the optional empty-body'));
  assert.match(freshCard, /if \(!silent\) this\._renderCardInto\(lineGuid,[\s\S]*?refx-propcard-loading/);
});

test('v4.49.3 target badge sits in the native backlink-pill slot on the full-width row', () => {
  assert.match(source, /body\.trc-zerolayout \.listitem \{\s*position: relative;/);
  assert.doesNotMatch(source, /body\.trc-zerolayout \.line-div::after/);
  assert.match(source, /\.trc-target-badge-wrap \{[\s\S]*?position: absolute;[\s\S]*?inset-inline-end: 0;[\s\S]*?width: 0;[\s\S]*?min-width: 0;[\s\S]*?overflow: visible;[\s\S]*?pointer-events: none;/);
  assert.match(source, /\.trc-target-badge \{[\s\S]*?font-weight: 600;[\s\S]*?padding: 4px;[\s\S]*?background: transparent;[\s\S]*?pointer-events: auto;/);
  assert.match(source, /if \(e\.node\.parentNode !== host\) host\.appendChild\(e\.node\)/);
  assert.match(source, /resolveTargetCountHost\(/);
});

test('v4.42 plain-line menu exposes the shared extension flyout context', () => {
  const lineMenu = source.slice(source.indexOf('  _openLineMenu('), source.indexOf('  // Copy the line'));
  assert.match(lineMenu, /_refMenuExtensionContext\(\{[\s\S]*?targetGuid: lineGuid,[\s\S]*?lineGuid,[\s\S]*?pageGuid:[\s\S]*?isText: true,/);
  assert.match(lineMenu, /_availableMenuExtensions\(extensionCtx\)[\s\S]*?flyout\("Extensions"/);
});

test('document observer rejects unrelated line mutations before decorator adoption', () => {
  assert.match(source, /if \(!relevant && !aliasRelevant && !queryRelevant\) return;/);
  assert.match(source, /if \(!managed && !li\.querySelector\('\.trc-refcount-badge-wrap/);
  assert.match(source, /this\._scheduleAlign\(lineGuid\);/);
});

test('startup-wide indexes share one input-aware cooperative lane', () => {
  assert.match(source, /_runBackgroundWork\('reference-surface-hydration'/);
  assert.match(source, /_runBackgroundWork\('record-name-index'/);
  assert.match(source, /_runBackgroundWork\('property-reference-index'/);
  assert.match(source, /_runBackgroundWork\('line-property-reference-index'/);
  assert.match(source, /_runBackgroundWork\('connection-index'/);
  const coordinator = source.slice(source.indexOf('  _initBackgroundWorkCoordinator()'), source.indexOf('  _nativePickerSelector()'));
  assert.match(coordinator, /this\._backgroundWorkTail = settled\.catch/);
  assert.match(coordinator, /Date\.now\(\) - \(this\._backgroundLastInputAt \|\| 0\) < quietMs/);
  assert.match(coordinator, /this\._backgroundWaitHandles = new Set\(\)/);
  assert.match(coordinator, /requestIdleCallback\(finish\)/);
  assert.match(coordinator, /cancelIdleCallback\(wait\.id\)/);
  assert.doesNotMatch(coordinator, /timeout\s*:/, 'quiet work must never be forced through active input by an idle timeout');
});

test('reference-chain chip decoration is idle-only, coalesced, and absent when counters are disabled', () => {
  const fullScan = source.slice(
    source.indexOf('  async _scanPanelImpl('),
    source.indexOf('  // The distinct reference-relevant')
  );
  const disabled = fullScan.slice(
    fullScan.indexOf('    if (!this._enabled) {'),
    fullScan.indexOf('    // v3.70.0 Guard 3:')
  );
  assert.doesNotMatch(disabled, /scanChipRefChains|scanSeq\s*=/);
  assert.match(fullScan, /this\._scheduleChipRefChainScan\(refs, state, seq\);/);
  assert.doesNotMatch(fullScan, /await this\.scanChipRefChains/);

  const rescan = source.slice(
    source.indexOf('  async rescanLines('),
    source.indexOf('  // Target-line badges for a SPECIFIC set of lines')
  );
  assert.match(rescan, /this\._scheduleChipRefChainScan\(refs, state, seq\);/);
  assert.doesNotMatch(rescan, /await this\.scanChipRefChains/);

  const scheduler = source.slice(
    source.indexOf('  _scheduleChipRefChainScan('),
    source.indexOf('  async scanChipRefChains(')
  );
  assert.match(scheduler, /state\.refChainScanRequest = \{ refs: Array\.from/);
  assert.match(scheduler, /if \(state\.refChainScanPending\) return;/);
  assert.match(scheduler, /_runBackgroundWork\('ref-chain-chip-scan:'/);
});

test('a closed Reference Workbench performs no startup collection or body read', () => {
  const startup = source.slice(source.indexOf('    this._rehydrate(0);'), source.indexOf('    // R6: idempotent pin migration'));
  assert.match(startup, /if \(this\._wbAdoptVisibleBacking\(\)\)/,
    'only an already-visible native Workbench may initialize during startup');
  assert.match(startup, /_runBackgroundWork\('visible-workbench-init'/,
    'a restored visible Workbench must still use the cooperative background lane');
  assert.doesNotMatch(startup, /try \{ this\._wbLiveInit\(\);/,
    'ordinary onLoad must not resolve or hydrate a closed Workbench');

  const open = source.slice(source.indexOf('  async _openWorkbenchLive('), source.indexOf('  _wbLiveScheduleRefresh('));
  const add = source.slice(source.indexOf('  async _wbAddLive('), source.indexOf('  // ── keep-alive observer'));
  assert.match(open, /await this\._wbLiveInit\(null, owner\)/, 'explicit Open must demand-initialize the shelf under its owner fence');
  assert.match(add, /await this\._wbLiveInit\(null, owner\)/, 'explicit Add must demand-initialize the shelf under its owner fence');
});

test('Workbench validates identity, serializes migration, and guards every SDK boundary', () => {
  const resolve = source.slice(source.indexOf('  async _wbResolveBacking('), source.indexOf('  _wbSemanticVariant('));
  const init = source.slice(source.indexOf('  async _wbLiveInit('), source.indexOf('  // The panel currently showing'));
  const load = source.slice(source.indexOf('  async _wbLoadLive('), source.indexOf('  // The panel currently showing'));
  const enumerate = source.slice(source.indexOf('  async _wbEnumerateBackingCandidates('), source.indexOf('  async _wbResolveBacking('));
  assert.match(resolve, /this\._wbBackingGuid === this\._wbBackingValidatedGuid/);
  assert.match(resolve, /this\._wbBackingValidatedCollectionGuid/);
  assert.match(resolve, /_wbPublishValidatedBacking\(match\.rec, match\.col, owner, epoch, true\)/);
  assert.match(enumerate, /await this\.data\.getAllCollections\(\)[\s\S]*?_recheckBackgroundGate\(backgroundGeneration\)[\s\S]*?await col\.getAllRecords\(\)[\s\S]*?_recheckBackgroundGate\(backgroundGeneration\)/);
  assert.match(init, /const rec = this\._wbBackingRecord/);
  assert.match(init, /await rec\.getLineItems\(false\)[\s\S]*?_recheckBackgroundGate\(backgroundGeneration\)/);
  assert.match(init, /if \(!guid && !backgroundGeneration[\s\S]*?_wbResolveBacking\(null, owner\)/,
    'an explicit action must retry a background resolution cancelled by its own input');
  assert.match(init, /if \(backgroundGeneration\) return true;[\s\S]*?rec\.createLineItem/,
    'legacy shelf writes must wait for explicit Workbench demand');
  assert.match(init, /_wbVerifyMigration\(verified, desired\)[\s\S]*?_wbSweepProvenance/,
    'legacy cleanup follows an authoritative native-line/meta verification');
  assert.doesNotMatch(load, /data\.getRecord\(/,
    'steady-state Workbench loads must not rebuild Thymer record maps');
  assert.match(load, /rec\.getLineItems\(false\)/);
});

test('visible Workbench refreshes use the background lane except immediate open', () => {
  const schedule = source.slice(source.indexOf('  _wbLiveScheduleRefresh('), source.indexOf('  // (Re)inject the per-item'));
  const refresh = source.slice(source.indexOf('  async _wbLiveRefresh('), source.indexOf('  _wbLiveDecorate('));
  assert.match(schedule, /_runBackgroundWork\('visible-workbench-refresh'/);
  assert.match(schedule, /if \(immediate\) \{[\s\S]*this\._wbLiveRefresh\(null, owner, refreshSeq\)/);
  assert.doesNotMatch(schedule, /this\._wbLiveRefresh\(\)\.catch/,
    'a refresh timer may enqueue gated work but never call the refresher directly');
  assert.match(refresh, /_wbLoadLive\(backgroundGeneration, owner, refreshSeq\)/);
  assert.match(refresh, /_wbRefreshCurrent\(owner, backgroundGeneration, refreshSeq\)/);
});

test('awaited startup SDK reads re-enter the native-input gate before follow-up work', () => {
  const recordNames = source.slice(source.indexOf('  async _buildRecordNameIndex('), source.indexOf('  // Keep one record'));
  const aliases = source.slice(source.indexOf('  async _aliasResolveRegistryRecord('), source.indexOf('  _aliasRegistryAliases('));
  const hydration = source.slice(source.indexOf('    const startHydration = async (backgroundGeneration) => {'), source.indexOf('    // Kick off hydration.'));
  assert.match(recordNames, /await this\.data\.getAllCollections\(\)[\s\S]*?_recheckBackgroundGate\(backgroundGeneration\)[\s\S]*?_aliasEnsureRegistryLoaded\(false, true, backgroundGeneration\)/);
  assert.match(recordNames, /col\.getAllRecords[\s\S]*?_recheckBackgroundGate\(backgroundGeneration\)/);
  assert.match(aliases, /_aliasResolveRegistryRecord\(false, backgroundGeneration\)[\s\S]*?_recheckBackgroundGate\(backgroundGeneration\)[\s\S]*?_aliasReadRegistrySnapshot\(rec, backgroundGeneration\)/);
  assert.match(hydration, /await self\.data\.getAllCollections\(\)[\s\S]*?_recheckBackgroundGate\(backgroundGeneration\)/);
  assert.match(hydration, /awaitedRecords[\s\S]*?_recheckBackgroundGate\(backgroundGeneration\)/);
});

test('cooperative property indexes cannot publish across record mutations', () => {
  const propBuild = source.slice(source.indexOf('  async _buildPropRefIndexChunked('), source.indexOf('  getPropertyTargetGuidsForRecord('));
  const linePropBuild = source.slice(source.indexOf('  async _buildLinePropRefIndexChunked('), source.indexOf('  // v3.74.0 NON-BLOCKING accessor'));
  const recordUpdate = source.slice(source.indexOf('  handleRecordUpdated('), source.indexOf('  // v3.33.0: incrementally reconcile'));
  assert.match(propBuild, /_referenceIndexDataGeneration/);
  assert.match(propBuild, /if \(rerun && !this\._isUnloading\) this\._schedulePropRefIndexBuild\(\)/);
  assert.match(linePropBuild, /_referenceIndexDataGeneration/);
  assert.match(recordUpdate, /this\._markReferenceIndexDataChanged\(\)/);
});

test('native picker portals bypass observer registry work globally', () => {
  assert.match(source, /\.autocomplete/);
  assert.match(source, /\[role="listbox"\]/);
  assert.match(source, /muts\?\.length && muts\.every\(\(m\) => this\._pickerOnlyMutation\(m\)\)\) return;/);
  const overlay = source.slice(source.indexOf('  _overlayAffectedLines('), source.indexOf('  _ensureOverlayObserver()'));
  assert.ok(overlay.indexOf('mutations.every') < overlay.indexOf('this._liveCheckOverlays.values()'), 'pure picker batches must return before live overlay enumeration');
});

test('startup target badges avoid a full-universe inbound scan', () => {
  const scan = source.slice(source.indexOf('  async scanTargetLineBadges('), source.indexOf('  // The .listitem[data-guid] that currently holds the caret'));
  assert.match(scan, /this\._observedInboundCountMap\(uncachedSet\)/);
  assert.match(scan, /_scheduleTargetBadgeAuthoritativeRefine\(state, seq, linesByGuid, uncached\)/,
    'cold-source and collection-filtered targets must all receive a deferred authoritative count');
  assert.doesNotMatch(scan, /info = \{ count: preCount, capped: false \}/,
    'an incomplete observed cache must never become an authoritative zero');
  assert.doesNotMatch(scan, /this\._registryInboundCountMap\(/);
  assert.doesNotMatch(scan, /Object\.values\(reg\)/);
});

test('initial panel discovery has no duplicate delayed forced refresh', () => {
  const init = source.slice(source.indexOf('    const panels = this.ui.getPanels?.() || [];'), source.indexOf('    // v3.37.0: install the overlay'));
  assert.match(init, /!seen\.has\(activeId\)/);
  assert.doesNotMatch(init, /initial-delayed/);
  assert.doesNotMatch(init, /refreshAllPanels/);
});
