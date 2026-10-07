import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import gsap from 'gsap';
import { useTranslation } from 'react-i18next';
import { GalaxyEngine } from './GalaxyEngine';
import { DEFAULT_ISLANDS, GALAXY_CONFIG, type IslandDef } from './config';
import { waveIslands } from './layout';
import './GalaxyMap.css';

export interface GalaxyMapHandle {
  warpTo: (id: string) => Promise<void>;
  returnToMap: () => Promise<void>;
  flyTo: (index: number) => void;
  viewAll: () => void;
  zoomBy: (factor: number) => void;
}

interface GalaxyMapProps {
  ref?: Ref<GalaxyMapHandle>;
  /** islands to place in alternating wave layout (up, down, up, down, up) */
  islands?: IslandDef[];
  starDensity?: number;
  worldScreens?: number;
  forceReducedMotion?: boolean;
  /** Renders the game for the entered island; defaults to a placeholder panel. */
  renderIsland?: (island: IslandDef, back: () => void) => ReactNode;
  onIslandChange?: (island: IslandDef | null) => void;
  /** Fired on hover/click, before the warp starts: a chance to warm the island's game. */
  onIslandIntent?: (island: IslandDef) => void;
  /** False for students and guests: they may look around the map but never open a game. */
  canEnter?: boolean;
}

const islandVars = (s: IslandDef) => ({ '--island-color': s.color, '--island-accent': s.accent }) as CSSProperties;

export function GalaxyMap({
  ref, islands: baseIslands = DEFAULT_ISLANDS, starDensity = 1, worldScreens = GALAXY_CONFIG.world.screens,
  forceReducedMotion = false, renderIsland, onIslandChange, onIslandIntent, canEnter = true,
}: GalaxyMapProps) {
  const { t } = useTranslation();
  const islands = useMemo(() => waveIslands(baseIslands), [baseIslands]);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<HTMLCanvasElement>(null);
  const grainRef = useRef<HTMLDivElement>(null);
  const loaderRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const fadeRef = useRef<HTMLDivElement>(null);
  const debugRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const miniViewRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GalaxyEngine | null>(null);

  const [nav, setNav] = useState({ prev: -1, next: -1 });
  const [entered, setEntered] = useState<number | null>(null);
  const [minimapOpen, setMinimapOpen] = useState(true);
  const [hintVisible, setHintVisible] = useState(true);
  const [focused, setFocused] = useState(-1);

  useEffect(() => {
    const [root, canvas, fx, grain, loader, hud, fade, debug] = [
      rootRef.current, canvasRef.current, fxRef.current, grainRef.current, loaderRef.current, hudRef.current, fadeRef.current, debugRef.current,
    ];
    if (!root || !canvas || !fx || !grain || !loader || !hud || !fade || !debug) return;
    const engine = new GalaxyEngine(
      { root, canvas, fx, grain, loader, hud, fade, debug },
      islands,
      {
        onNav: (prev, next) => setNav({ prev, next }),
        onEnter: i => {
          setEntered(i);
          onIslandChange?.(islands[i] ?? null);
        },
        onExit: () => {
          setEntered(null);
          onIslandChange?.(null);
        },
        onFocusChange: setFocused,
      },
      // later option changes go through setOptions below
      { starDensity, worldScreens, forceReducedMotion },
    );
    engine.setMiniView(miniViewRef.current);
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
      // a new engine starts outside any island
      setEntered(null);
      setNav({ prev: -1, next: -1 });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the engine is rebuilt only when the islands change
  }, [islands]);

  useEffect(() => {
    engineRef.current?.setOptions({ starDensity, worldScreens, forceReducedMotion });
  }, [starDensity, worldScreens, forceReducedMotion]);

  // the hint is onboarding copy: show it once, then give the space back to the map
  useEffect(() => {
    const id = setTimeout(() => setHintVisible(false), 7000);
    return () => clearTimeout(id);
  }, []);

  // before paint, so the panel never flashes in fully visible
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (entered == null || !panel) return;
    const reduced = forceReducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tween = gsap.from(panel.children, {
      opacity: 0, y: reduced ? 0 : 12, duration: reduced ? 0.8 : 0.5, stagger: 0.07, ease: 'power2.out', clearProps: 'opacity,transform',
    });
    return () => { tween.kill(); };
  }, [entered, forceReducedMotion]);

  useImperativeHandle(ref, () => ({
    warpTo: id => engineRef.current?.warpTo(id) ?? Promise.resolve(),
    returnToMap: () => engineRef.current?.returnToMap() ?? Promise.resolve(),
    flyTo: i => engineRef.current?.flyTo(i),
    viewAll: () => engineRef.current?.viewAll(),
    zoomBy: f => engineRef.current?.zoomBy(f),
  }), []);

  const setMiniView = (el: HTMLDivElement | null) => {
    miniViewRef.current = el;
    engineRef.current?.setMiniView(el);
  };
  const back = useCallback(() => { void engineRef.current?.returnToMap(); }, []);
  const prevIsland = islands[nav.prev], nextIsland = islands[nav.next], island = entered == null ? null : islands[entered];

  return (
    <div ref={rootRef} className="gx-root" tabIndex={0} aria-label={t('map.aria')}>
      <canvas ref={canvasRef} className="gx-layer" />
      <div ref={grainRef} className="gx-layer gx-grain" />

      <div className="gx-layer gx-islands">
        {islands.map((s, i) => (
          <div key={s.id} className="gx-island-wrap" data-island-wrap="" style={islandVars(s)}>
            <button
              type="button"
              className="gx-island"
              data-island-body=""
              aria-label={t('map.enter', { name: s.label })}
              onClick={() => {
                onIslandIntent?.(s);
                // Watchers can still fly around the map; only a teacher opens a game.
                if (canEnter) engineRef.current?.handleIslandClick(s.id);
                else engineRef.current?.flyTo(i);
              }}
              onPointerEnter={() => onIslandIntent?.(s)}
              onFocus={() => {
                onIslandIntent?.(s);
                engineRef.current?.focusIsland(i);
              }}
              onBlur={() => engineRef.current?.focusIsland(-1)}
            >
              {s.core && (
                <span
                  className="gx-island-core"
                  style={{
                    left: `${s.core.x * 100}%`, top: `${s.core.y * 100}%`,
                    width: `${s.core.rx * 200}%`, height: `${(s.core.ry * 200) / s.aspect}%`,
                  }}
                />
              )}
              <img src={s.image} alt="" draggable={false} decoding="async" />
            </button>
            <div className="gx-island-label" data-island-label="">
              {s.label}
              {canEnter && focused === i && <span className="gx-island-cta">{t('map.clickToEnter')}</span>}
            </div>
          </div>
        ))}
      </div>

      <canvas ref={fxRef} className="gx-layer gx-fx" />

      <div ref={hudRef} className="gx-layer gx-hud">
        {hintVisible && <div className="gx-hint">{t('map.hint')}</div>}

        {prevIsland && (
          <div className="gx-arrow gx-arrow-prev">
            <button type="button" data-ui="" className="rc-cut gx-glass gx-arrow-btn" aria-label={t('map.prev', { name: prevIsland.label })}
              title={prevIsland.label} onClick={() => engineRef.current?.goPrev()}>‹</button>
            <div className="gx-arrow-label">{prevIsland.label}</div>
          </div>
        )}
        {nextIsland && (
          <div className="gx-arrow gx-arrow-next">
            <button type="button" data-ui="" className="rc-cut gx-glass gx-arrow-btn" aria-label={t('map.next', { name: nextIsland.label })}
              title={nextIsland.label} onClick={() => engineRef.current?.goNext()}>›</button>
            <div className="gx-arrow-label">{nextIsland.label}</div>
          </div>
        )}

        <div data-ui="" className="rc-cut gx-glass gx-minimap">
          <button type="button" className="gx-minimap-toggle" aria-expanded={minimapOpen}
            aria-label={minimapOpen ? t('map.collapse') : t('map.expand')} onClick={() => setMinimapOpen(o => !o)}>
            <span>{t('map.starMap')}</span>
            <span aria-hidden="true">{minimapOpen ? '−' : '+'}</span>
          </button>
          {minimapOpen && (
            <div className="gx-minimap-body">
              {GALAXY_CONFIG.path.enabled && (
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <polyline points={islands.map(s => `${s.x * 100},${s.y * 100}`).join(' ')} />
                </svg>
              )}
              <div ref={setMiniView} className="gx-minimap-view" />
              {islands.map((s, i) => (
                <button key={s.id} type="button" className="gx-minimap-dot" style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, ...islandVars(s) }}
                  aria-label={t('map.flyTo', { name: s.label })} title={s.label} onClick={() => engineRef.current?.flyTo(i)}>
                  <span />
                </button>
              ))}
            </div>
          )}
        </div>

        <div data-ui="" className="rc-cut gx-glass gx-zoom">
          <button type="button" aria-label={t('map.zoomIn')} title={t('map.zoomIn')} onClick={() => engineRef.current?.zoomBy(GALAXY_CONFIG.camera.buttonZoom)}>+</button>
          <button type="button" aria-label={t('map.zoomOut')} title={t('map.zoomOut')} onClick={() => engineRef.current?.zoomBy(1 / GALAXY_CONFIG.camera.buttonZoom)}>−</button>
          <hr />
          <button type="button" className="gx-zoom-all" title={t('map.viewAllTitle')} onClick={() => engineRef.current?.viewAll()}>{t('map.viewAll')}</button>
        </div>
      </div>

      <div ref={loaderRef} className="gx-layer gx-loader" aria-live="polite">
        <div className="gx-loader-dots"><span /><span /><span /></div>
        <div>{t('map.loading')}</div>
      </div>

      <div ref={fadeRef} className="gx-layer gx-fade" />
      <div ref={debugRef} className="gx-debug" />

      {island && (
        <div ref={panelRef} data-ui="" className="gx-layer gx-panel" style={islandVars(island)}>
          {renderIsland ? renderIsland(island, back) : (
            <>
              <div className="gx-panel-kicker">{t('map.nowEntering')}</div>
              <div className="gx-panel-title">{island.label}</div>
              <div className="gx-panel-note">{t('map.gamePlaceholder')}</div>
              <button type="button" className="rc-cut gx-panel-back" onClick={back}>{t('map.back')}</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
