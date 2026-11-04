const root = document.querySelector<HTMLElement>('[data-engine-demo]');

if (root) {
  const layerCount = 12;
  const stages = ['manifest', 'read', 'prepare', 'install', 'time-mix', 'channel-mix', 'commit'];
  const exampleTokens = ['The', 'model', 'reads', 'one', 'layer', 'at', 'a', 'time'];
  const q = <T extends Element>(selector: string) => root.querySelector<T>(selector);
  const all = <T extends Element>(selector: string) => [...root.querySelectorAll<T>(selector)];
  const text = (selector: string, value: string) => {
    const element = q<HTMLElement>(selector);
    if (element) element.textContent = value;
  };
  const modes = {
    strict: { label: 'Read each layer · no retained layer cache', cap: 0, pinned: 0 },
    bounded: { label: 'Small RAM cache · 3 layers', cap: 3, pinned: 0 },
    partial: { label: 'Keep 3 layers · plus 3 cache slots', cap: 3, pinned: 3 },
    resident: { label: 'All model weights in RAM', cap: 0, pinned: 12 },
  };
  type Mode = keyof typeof modes;
  const state = {
    mode: 'bounded' as Mode,
    layer: 0, stage: 0, token: 1, source: 'none',
    reads: 0, hits: 0, misses: 0, prefetchHits: 0, prefetchMisses: 0, evictions: 0,
    cache: [] as number[], ready: new Set<number>(), pending: new Set<number>(),
    sessions: 1, running: false, paused: false, runId: 0, transfer: '',
    output: [] as string[], log: [] as string[],
  };
  const backend = q<HTMLSelectElement>('[data-demo-backend]')!;
  const codec = q<HTMLSelectElement>('[data-demo-codec]')!;
  const prefetch = q<HTMLSelectElement>('[data-demo-prefetch]')!;
  const sessions = q<HTMLSelectElement>('[data-demo-sessions]')!;
  const speed = q<HTMLSelectElement>('[data-demo-speed]')!;
  const stepButton = q<HTMLButtonElement>('[data-demo-step-action]')!;
  const layerButton = q<HTMLButtonElement>('[data-demo-layer-action]')!;
  const runButton = q<HTMLButtonElement>('[data-demo-run]')!;

  const config = () => modes[state.mode];
  const residentLayer = (layer: number) => layer < config().pinned;
  const complete = () => state.layer === layerCount - 1 && state.stage === stages.length;
  const native = () => backend.value === 'native';
  const readAheadEnabled = () => state.mode !== 'resident'
    && !(state.mode === 'strict' && !native()) && prefetch.value !== 'off';
  const loaded = () => state.stage >= 2 && state.stage < stages.length && state.mode !== 'resident';

  function log(message: string) {
    state.log.unshift(message);
    state.log.length = Math.min(state.log.length, 7);
    const list = q<HTMLOListElement>('[data-demo-log]');
    if (!list) return;
    list.replaceChildren(...state.log.map((line) => {
      const item = document.createElement('li');
      item.textContent = line;
      return item;
    }));
  }

  function message(value: string) {
    text('[data-demo-message]', value);
  }

  function syncControls() {
    const unavailable = state.mode === 'resident' || (state.mode === 'strict' && !native());
    prefetch.disabled = unavailable;
    // Native rwkv.cpp requests N+1 directly. AdaptiveGatePlanner belongs to
    // the reference streaming planner shown in the other backend selection.
    const adaptiveOption = prefetch.querySelector<HTMLOptionElement>('[value="adaptive"]');
    if (adaptiveOption) adaptiveOption.disabled = native();
    if (native() && prefetch.value === 'adaptive') prefetch.value = 'next';
    stepButton.disabled = state.running;
    layerButton.disabled = state.running;
    runButton.textContent = state.running ? 'Pause' : complete() ? 'Run next token →' : 'Run full token →';
    runButton.setAttribute('aria-pressed', String(state.running));
    all<HTMLButtonElement>('[data-demo-mode]').forEach((button) => {
      const selected = button.dataset.demoMode === state.mode;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  function renderCache() {
    const { pinned, cap } = config();
    all<HTMLElement>('[data-cache-slot]').forEach((slot, index) => {
      slot.classList.remove('is-filled', 'is-pinned', 'is-active');
      slot.hidden = false;
      let label = `cache ${index - pinned + 1}`;
      let value = 'empty';
      let layer: number | undefined;
      if (state.mode === 'resident') {
        slot.hidden = index > 0;
        label = 'RAM';
        value = 'all layers';
        slot.classList.add('is-filled', 'is-pinned');
      } else if (state.mode === 'strict') {
        slot.hidden = index > 0;
        label = 'temporary';
        value = loaded() ? `L${state.layer + 1}` : 'released';
        slot.classList.toggle('is-active', loaded());
      } else if (index < pinned) {
        label = 'pinned';
        layer = index;
        slot.classList.add('is-pinned');
      } else {
        slot.hidden = index - pinned >= cap;
        layer = state.cache[index - pinned];
      }
      if (layer !== undefined) {
        value = `L${layer + 1}`;
        slot.classList.add('is-filled');
        slot.classList.toggle('is-active', layer === state.layer && loaded());
      }
      const heading = slot.querySelector('span');
      const content = slot.querySelector('b');
      if (heading) heading.textContent = label;
      if (content) content.textContent = value;
    });
    text('[data-demo-cache-status]', state.mode === 'strict' ? 'read on demand' : state.mode === 'resident' ? 'all weights' : 'kept in RAM');
    text('[data-demo-provider-note]', `Illustrative layer slots. The engine accounts for provider records and native decoded caches separately. ${state.evictions} eviction${state.evictions === 1 ? '' : 's'}.`);
  }

  function render() {
    const stage = stages[state.stage - 1] ?? 'idle';
    const current = state.layer + 1;
    const captions: Record<string, string> = {
      idle: 'Press play or step through a layer.',
      manifest: `Find L${current} in the model pack.`,
      read: state.source === 'storage' ? `Read L${current} from the pack.` : `Reuse L${current} from ${state.source === 'prefetch' ? 'read-ahead' : state.source}.`,
      prepare: codec.value === 'u8' && native() ? `L${current}: keep supported matrices packed.` : `L${current}: prepare dense weights.`,
      install: `L${current}: ${state.mode === 'resident' ? 'reuse resident weights' : 'install active weights'}.`,
      'time-mix': `L${current}: update recurrent state for ${state.sessions} session${state.sessions === 1 ? '' : 's'}.`,
      'channel-mix': `L${current}: channel mix and residual update.`,
      commit: complete() ? 'Token complete. State is ready for the next pass.' : `L${current} complete. Advance to L${current + 1}.`,
    };
    message(captions[stage]);
    const { pinned, cap } = config();
    const queued = [...state.ready, ...state.pending].sort((a, b) => a - b);
    root.dataset.stage = stage;
    root.dataset.mode = state.mode;
    root.dataset.paused = String(state.paused);
    text('[data-demo-mode-label]', config().label);
    text('[data-demo-token]', `#${state.token}${complete() ? ' · complete' : ''}`);
    text('[data-demo-layer]', `L${current} / ${layerCount}${state.stage === stages.length ? ' · done' : ''}`);
    text('[data-demo-memory]', state.mode === 'resident' ? 'all layers in RAM' : state.mode === 'strict' ? 'one layer at a time' : `${pinned ? `${pinned} kept + ` : ''}${state.cache.length} / ${cap} cached`);
    text('[data-demo-reads]', `${state.reads} layer requests`);
    text('[data-demo-read-bytes]', `${state.reads} logical layer reads`);
    text('[data-demo-cache]', `${state.hits} hits · ${state.misses} misses`);
    text('[data-demo-prefetch-metrics]', `${state.prefetchHits} hits · ${state.prefetchMisses} misses`);
    text('[data-demo-step-count]', `${state.stage} / ${stages.length}${complete() ? ' · token complete' : ''}`);
    text('[data-demo-record]', `blocks.${state.layer}.*`);
    text('[data-demo-activation]', complete() ? `token ${state.token} → output head` : `token ${state.token} → L${current}`);
    text('[data-demo-state-label]', state.stage === stages.length ? `L${current} state saved` : stage === 'time-mix' || stage === 'channel-mix' ? `L${current} state in use` : `L${current} state ready`);
    text('[data-demo-state-status]', `${state.sessions} session${state.sessions > 1 ? 's' : ''} · resident`);
    text('[data-demo-state-memory]', `${state.sessions} × ${layerCount} layer states`);
    text('[data-demo-retained]', state.mode === 'resident' ? 'all layers in RAM' : `${pinned} kept + ${state.cache.length} / ${cap} cached`);
    text('[data-demo-inflight]', state.mode === 'resident' ? 'resident graph' : `${loaded() ? '1 active block' : 'no active block'} · ${queued.length} read-ahead`);
    text('[data-demo-result]', state.output.length ? state.output.join(' ') : 'waiting for all blocks');
    text('[data-demo-read-status]', state.pending.size ? `reading ahead · ${state.pending.size} span${state.pending.size > 1 ? 's' : ''}` : state.transfer === 'pack-provider' ? 'requested pack spans' : state.source === 'resident' ? 'all weights in RAM' : state.source === 'pinned' ? 'kept in RAM' : state.source === 'cache' ? 'cache hit' : state.source === 'prefetch' ? 'read-ahead hit' : 'idle');
    text('[data-demo-compute-status]', stage === 'time-mix' || stage === 'channel-mix' ? 'executing block' : stage === 'commit' ? 'block complete' : stage === 'install' ? 'weights installed' : stage === 'prepare' ? 'preparing weights' : 'waiting');
    text('[data-demo-prepare-title]', codec.value === 'raw' ? 'Prepare dense weights' : native() ? 'Packed matrices / dense controls' : 'Decode grouped U8 to dense');
    text('[data-demo-stage-detail]', state.source === 'resident' || state.source === 'pinned' ? 'reuse weights prepared at startup' : state.source === 'cache' ? 'reuse retained layer data' : native() && codec.value === 'u8' ? 'supported matrices stay packed on CPU' : 'prepare the dense tensors for this block');
    text('[data-demo-sync-title]', state.mode === 'resident' ? 'Reuse resident weights' : native() ? 'Install native block' : 'Set reference block tensors');
    text('[data-demo-sync-detail]', state.mode === 'resident' ? 'full model loaded before decoding' : native() ? 'reuse one layer-local graph plan' : 'inject prepared weights into model.z');
    text('[data-demo-compute-detail]', `${state.sessions} session${state.sessions > 1 ? 's' : ''} share this weight load`);
    text('[data-demo-compute-note]', native() ? 'The operations below break down one native layer_step call. This CPU path has no host-to-GPU transfer.' : 'This view follows the dense reference path. Optional fused LUT kernels use a separate packed path.');
    text('[data-demo-path-note]', state.mode === 'resident'
      ? 'All weights stay in memory.'
      : state.mode === 'strict' && !native()
        ? 'Demand reads. Release each layer after use.'
        : native()
          ? 'CPU streaming · reusable layer graph'
          : 'Reference streaming · dense layer weights');

    all<HTMLElement>('[data-ssd-layer]').forEach((item, index) => {
      item.classList.toggle('is-current', index === state.layer);
      item.classList.toggle('is-prefetched', state.ready.has(index) || state.pending.has(index));
      item.classList.toggle('is-reading', state.pending.has(index) || (index === state.layer && state.transfer === 'pack-provider'));
    });
    all<HTMLElement>('[data-rwkv-layer]').forEach((item, index) => {
      item.classList.toggle('is-current', index === state.layer);
      item.classList.toggle('is-done', index < state.layer || (index === state.layer && state.stage === stages.length));
    });
    all<HTMLElement>('[data-state-layer]').forEach((item, index) => {
      item.classList.toggle('is-current', index === state.layer && (stage === 'time-mix' || stage === 'channel-mix'));
      item.classList.toggle('is-updated', index < state.layer || (index === state.layer && stage === 'commit'));
    });
    all<HTMLElement>('[data-trace]').forEach((item, index) => {
      item.classList.toggle('is-active', index === state.stage - 1);
      item.classList.toggle('is-done', index < state.stage - 1);
    });
    all<HTMLElement>('[data-compute-step]').forEach((item) => {
      const index = item.dataset.computeStep === 'prepare' ? 2 : item.dataset.computeStep === 'sync' ? 3 : 4;
      item.classList.toggle('is-active', item.dataset.computeStep === 'compute' ? state.stage >= 5 && state.stage <= 6 : state.stage - 1 === index);
      item.classList.toggle('is-done', item.dataset.computeStep === 'compute' ? state.stage === 7 : state.stage - 1 > index);
    });
    all<HTMLElement>('[data-block-op]').forEach((item) => {
      const index = stages.indexOf(item.dataset.blockOp ?? '');
      item.classList.toggle('is-active', stage === item.dataset.blockOp);
      item.classList.toggle('is-done', state.stage - 1 > index);
    });
    all<HTMLElement>('[data-demo-packet]').forEach((packet) => {
      const route = packet.closest<HTMLElement>('[data-pipeline-route]')?.dataset.pipelineRoute;
      packet.classList.toggle('is-moving', route === state.transfer || (route === 'pack-provider' && state.pending.size > 0));
    });
    text('[data-prefetch-item]', queued.length ? queued.map((layer) => `L${layer + 1} ${state.pending.has(layer) ? 'reading' : 'ready'}`).join(' · ') : readAheadEnabled() ? 'empty' : 'disabled for this path');
    all<HTMLElement>('.prefetch-strip i').forEach((dot, index) => dot.classList.toggle('is-ready', index < queued.length));
    all<HTMLElement>('[data-memory-slot]').forEach((slot, index) => {
      slot.classList.toggle('is-filled', index < pinned + state.cache.length);
      slot.classList.toggle('is-pinned', index < pinned);
    });
    all<HTMLElement>('[data-timeline-block]').forEach((cell, index) => {
      cell.classList.toggle('is-done', index < state.stage);
      cell.classList.toggle('is-current', index === state.stage - 1);
    });
    const ahead = readAheadEnabled() && queued.length > 0;
    all<HTMLElement>('[data-timeline-io]').forEach((cell, index) => {
      cell.classList.toggle('is-done', ahead && index >= 1 && index < Math.min(state.stage, 6));
      cell.classList.toggle('is-current', ahead && index === Math.min(state.stage - 1, 5));
    });
    text('[data-demo-overlap]', state.pending.size
      ? `${[...state.pending].map((layer) => `Read L${layer + 1}`).join(' + ')} alongside L${current}`
      : queued.length
        ? `${queued.map((layer) => `L${layer + 1}`).join(' + ')} ready at provider`
        : readAheadEnabled() ? `L${current} · no new read-ahead needed yet` : 'Read-ahead off · demand reads or all in RAM');
    const buffer = q<HTMLElement>('[data-demo-buffer]');
    if (buffer) buffer.style.width = loaded() ? '100%' : '0%';
    text('[data-demo-buffer-label]', state.mode === 'resident' ? 'resident' : loaded() ? 'loaded' : 'idle');
    const sessionList = q<HTMLElement>('[data-demo-session-list]');
    if (sessionList) sessionList.replaceChildren(...Array.from({ length: state.sessions }, (_, index) => {
      const chip = document.createElement('span');
      chip.className = `session-chip${state.stage >= 5 ? ' is-active' : ''}`;
      chip.textContent = `session ${index + 1} · L${current} ${stage === 'commit' ? 'saved' : 'state'}`;
      return chip;
    }));
    renderCache();
    syncControls();
  }

  function queueReadAhead() {
    if (!readAheadEnabled()) return [] as number[];
    const depth = !native() && prefetch.value === 'adaptive' && state.layer > 0 ? 2 : 1;
    const queued: number[] = [];
    for (let distance = 1; distance <= depth; distance++) {
      const layer = state.layer + distance;
      if (layer >= layerCount || residentLayer(layer) || state.cache.includes(layer) || state.ready.has(layer) || state.pending.has(layer)) continue;
      state.pending.add(layer);
      queued.push(layer);
    }
    state.reads += queued.length;
    if (queued.length) log(`Read-ahead requested ${queued.map((layer) => `L${layer + 1}`).join(', ')}. These reads can overlap current-block work.`);
    return queued;
  }

  function advanceLayer() {
    if (state.stage < stages.length) return;
    if (complete()) {
      state.layer = 0;
      state.token++;
    } else state.layer++;
    state.stage = 0;
    state.source = 'none';
    state.transfer = '';
  }

  function runStage() {
    state.paused = false;
    advanceLayer();
    const stage = stages[state.stage];
    const current = state.layer + 1;
    state.transfer = '';
    if (stage === 'manifest') {
      message(`The manifest groups blocks.${state.layer}.* into layer ${current}. Its tensor records identify shapes, codecs, offsets, and lengths in the pack. Global embedding and head weights were prepared at startup.`);
      log(`Manifest selected L${current} tensor records. No block data moved.`);
    } else if (stage === 'read') {
      if (residentLayer(state.layer)) {
        state.source = state.mode === 'resident' ? 'resident' : 'pinned';
        state.hits++;
        message(`L${current} is ${state.source === 'resident' ? 'part of the resident model' : 'in the pinned set'}. Its block weights need no new pack read.`);
        log(`L${current} reused ${state.source} weights.`);
      } else if (state.cache.includes(state.layer)) {
        state.source = 'cache';
        state.hits++;
        state.cache = [state.layer, ...state.cache.filter((layer) => layer !== state.layer)];
        message(`L${current} is retained in the bounded weight cache. The engine reuses it and moves it to the front of the LRU order.`);
        log(`L${current} retained-cache hit.`);
      } else {
        state.misses++;
        if (state.ready.delete(state.layer)) {
          state.source = 'prefetch';
          state.prefetchHits++;
          message(`L${current} was not retained, but read-ahead already fetched its pack spans. This simulated hit avoids a blocking pack request at this point.`);
          log(`L${current} read-ahead hit. No new demand read.`);
        } else {
          state.source = 'storage';
          state.transfer = 'pack-provider';
          state.reads++;
          if (readAheadEnabled()) state.prefetchMisses++;
          message(`The provider requests L${current}'s ${codec.value === 'u8' ? 'grouped-U8 records' : 'dense tensor spans'}. Memory mapping or positioned I/O supplies them; the operating system may serve the bytes from its file cache.`);
          log(`L${current} demand pack read. This counter does not measure physical SSD traffic.`);
        }
      }
      const queued = queueReadAhead();
      if (queued.length) {
        const extra = !native() && prefetch.value === 'adaptive' && state.layer > 0 ? ' The adaptive example assumes the previous block was I/O-bound.' : '';
        const element = q<HTMLElement>('[data-demo-message]');
        if (element) element.textContent += ` Read-ahead queues ${queued.map((layer) => `L${layer + 1}`).join(', ')} while this block is prepared and processed.${extra}`;
      }
    } else if (stage === 'prepare') {
      if (state.source === 'resident' || state.source === 'pinned' || state.source === 'cache') {
        message(`The engine reuses L${current}'s prepared weights. It does not decode the same retained tensors again.`);
      } else {
        if (config().cap > 0) {
          if (state.cache.length >= config().cap) {
            const evicted = state.cache.pop()!;
            state.evictions++;
            log(`Evicted L${evicted + 1} to keep the retained cache within its cap.`);
          }
          state.cache.unshift(state.layer);
        }
        message(codec.value === 'raw'
          ? `Dense L${current} tensors are prepared for the active block. A native dense upload can borrow provider-owned tensors when their lifetime permits it.`
          : native()
            ? `Supported grouped-U8 matrices remain packed for native CPU execution. Small control tensors use dense values. This avoids a second full dense matrix payload for the supported packed-only path.`
            : `This reference path decodes grouped-U8 records into dense block tensors. The engine also has optional fused LUT paths, which follow a different preparation route.`);
      }
      log(`L${current} weights ready for ${native() ? 'the native block plan' : 'the reference forward pass'}.`);
    } else if (stage === 'install') {
      if (state.mode === 'resident') {
        message('Resident mode already owns the full model. Its weights stay available across tokens without block-by-block provider uploads.');
        log(`L${current} uses the resident model.`);
      } else {
        state.transfer = 'provider-compute';
        message(native()
          ? `The bridge installs L${current} in a reusable layer-local GGML plan. That plan owns the active block's execution, rather than keeping an unbounded second model copy.`
          : `The reference path makes L${current}'s prepared tensors available in model.z for the streaming forward pass.`);
        log(`L${current} installed. One weight load can serve ${state.sessions} session${state.sessions > 1 ? 's' : ''}.`);
      }
    } else if (stage === 'time-mix') {
      state.transfer = 'compute-state';
      message(`For each of the ${state.sessions} session${state.sessions > 1 ? 's' : ''}, the block normalizes its current activation and runs time mixing with that session's previous activation and recurrent attention state. RWKV updates a fixed-size state instead of appending a key/value cache.`);
      log(`Inside L${current}: time mix reads and updates each session's recurrent state.`);
    } else if (stage === 'channel-mix') {
      message(`The time-mix result is added to the residual activation. The block normalizes it again, runs channel mixing with the session's prior activation, and adds the feed-forward result. Sessions share weights and keep separate activations and state.`);
      log(`Inside L${current}: channel mix and residual update for ${state.sessions} session${state.sessions > 1 ? 's' : ''}.`);
    } else if (stage === 'commit') {
      state.transfer = 'compute-state';
      state.pending.forEach((layer) => state.ready.add(layer));
      state.pending.clear();
      const retention = state.mode === 'strict' ? 'Temporary block tensors are released. The next streamed block will replace them.' : state.mode === 'resident' ? 'Resident weights remain loaded for the next token.' : 'Retained weights stay within the selected cache cap. A later admission can evict them.';
      message(`L${current}'s updated state is saved separately for every session. The output activation advances to ${current === layerCount ? 'the final normalization and output head' : `L${current + 1}`}. ${retention}`);
      log(`L${current} complete. Saved ${state.sessions} session state${state.sessions > 1 ? 's' : ''}; ${state.mode === 'strict' ? 'released temporary weights' : 'kept weights within the selected policy'}.`);
      if (current === layerCount) {
        const word = exampleTokens[(state.token - 1) % exampleTokens.length];
        state.output.push(word);
        message(`The final normalization and output head turn the last activation into logits. A sampler selects the next token. “${word}” is a scripted example; this page does not run a language model. The recurrent state remains ready for the next token.`);
        log(`Token ${state.token} complete. Illustrative output: ${word}.`);
      }
    }
    state.stage++;
    render();
  }

  function pause() {
    state.runId++;
    state.running = false;
    state.paused = true;
    render();
  }

  function reset() {
    state.runId++;
    Object.assign(state, { layer: 0, stage: 0, token: 1, source: 'none', reads: 0, hits: 0, misses: 0, prefetchHits: 0, prefetchMisses: 0, evictions: 0, running: false, paused: false, transfer: '' });
    state.cache = [];
    state.ready.clear();
    state.pending.clear();
    state.output = [];
    state.log = [];
    state.sessions = Number(sessions.value);
    log('Engine ready. Select a setting, then run one stage, one block, or a complete token.');
    message('Start a pass to inspect each stage. Startup preparation is complete; pack read counters begin here.');
    render();
  }

  async function play(oneLayer: boolean) {
    advanceLayer();
    const runId = ++state.runId;
    state.running = true;
    state.paused = false;
    render();
    while (runId === state.runId) {
      runStage();
      if (complete() || (oneLayer && state.stage === stages.length)) break;
      await new Promise((resolve) => window.setTimeout(resolve, Number(speed.value)));
    }
    if (runId === state.runId) {
      state.running = false;
      render();
    }
  }

  all<HTMLButtonElement>('[data-demo-mode]').forEach((button) => button.addEventListener('click', () => {
    state.mode = button.dataset.demoMode as Mode;
    reset();
  }));
  [backend, codec, prefetch, sessions].forEach((control) => control.addEventListener('change', reset));
  stepButton.addEventListener('click', runStage);
  layerButton.addEventListener('click', () => { void play(true); });
  runButton.addEventListener('click', () => { if (state.running) pause(); else void play(false); });
  q<HTMLButtonElement>('[data-demo-reset]')?.addEventListener('click', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden && state.running) pause(); });
  reset();
}
