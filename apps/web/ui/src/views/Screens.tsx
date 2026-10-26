// The screens on a map of where each button leads; one opens into its mockup editor.
import { ArrowLeft, ImagePlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Screen } from '@aligner/core/context';
import { markBusy, markDone, useApp } from '../state';
import { DeleteButton, EditableText } from '../components/edit';
import { MockupEditor, type Screenshot } from './Mockup';
import { ScreenMap } from './ScreenMap';

export function Screens() {
  const { product, nav } = useApp();
  const screen = product.model.screens.find((s) => s.id === nav.screen);
  return screen ? <ScreenEditor key={screen.id} screen={screen} /> : <ScreenMap />;
}

// ---- Editor ---------------------------------------------------------------------------

function ScreenEditor({ screen }: { screen: Screen }) {
  const { product, edit, go, setPicture } = useApp();
  const [nonce, setNonce] = useState(0);
  const screenshot = useScreenshot(screen.picture, nonce);
  const usedIn = product.model.flows.filter((f) => f.steps.some((s) => s.screen === screen.id));

  return (
    <div className="flex min-h-0 flex-1 flex-col px-6 pb-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button onClick={() => go({ screen: undefined })} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[13px] text-neutral-500 hover:bg-white hover:text-neutral-900"><ArrowLeft className="size-4" /> Screens</button>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
          <EditableText value={screen.name} title={screen.id} onSave={(name) => void edit({ op: 'modify', id: screen.id, fields: { name } })} />
        </h1>
        {usedIn.length > 0 && (
          <span className="text-[13px] text-neutral-400">
            in {usedIn.map((f, i) => (
              <span key={f.id}>{i > 0 && ', '}<button onClick={() => go({ view: 'flows', flow: f.id, selected: f.steps.find((s) => s.screen === screen.id)?.id })} className="text-neutral-600 hover:underline">{f.name}</button></span>
            ))}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-neutral-600 hover:bg-white">
            <ImagePlus className="size-4" /> {screen.picture ? 'Replace screenshot' : 'Add screenshot'}
            <input data-screenshot-input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { await setPicture(screen.id, f); setNonce((n) => n + 1); } }} />
          </label>
          <DeleteButton label="Delete screen" always onDelete={() => void edit({ op: 'remove', id: screen.id }).then(() => go({ screen: undefined }))} className="!p-1.5" />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {screenshot !== undefined ? <MockupEditor key={screen.id} screen={screen} screenshot={screenshot} /> : <p className="pt-24 text-center text-sm text-neutral-400">Opening the screen…</p>}
      </div>
    </div>
  );
}

/** The screenshot with its size: null when the screen has none, undefined while it loads. */
function useScreenshot(path: string | undefined, nonce: number): Screenshot | null | undefined {
  const url = usePictureUrlOnce(path, nonce);
  const [shot, setShot] = useState<Screenshot | null>();
  useEffect(() => {
    if (!path) { setShot(null); return; }
    if (!url) return;
    let live = true;
    markBusy();
    const img = new Image();
    img.onload = () => { if (live) setShot({ url, width: img.naturalWidth || 390, height: img.naturalHeight || 844 }); markDone(); };
    img.onerror = () => { if (live) setShot(null); markDone(); };
    img.src = url;
    return () => { live = false; };
  }, [path, url]);
  return shot;
}

/** The screenshot as a data URL; `nonce` fetches it again after it was replaced at the same path. */
function usePictureUrlOnce(path: string | undefined, nonce: number) {
  const { host, at } = useApp();
  const [url, setUrl] = useState<{ key: string; url: string }>();
  const key = `${path}#${nonce}`;
  useEffect(() => {
    if (!path) return;
    let live = true;
    void host.api.picture(at, path).then((u) => { if (live) setUrl({ key, url: u }); }).catch(() => undefined);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return url?.key === key ? url.url : undefined;
}
