import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { markBusy, markDone, useApp } from '../state';

/** A screen picture, fetched from the server as a data URL (the single-file UI loads no local files). */
export function usePictureUrl(path: string | undefined): string | undefined {
  const { picture, product } = useApp();
  const [url, setUrl] = useState<{ key: string; url: string }>();
  const key = `${product.loadedAt}:${path}`;
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    markBusy();
    picture(path).then((u) => { if (!cancelled) setUrl({ key, url: u }); }).catch(() => undefined).finally(markDone);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return url?.key === key ? url.url : undefined;
}

/** The largest box with a picture's shape (width / height) that fits `maxW` × `maxH`. */
export function fitBox(ratio: number, maxW: number, maxH: number): { width: number; height: number } {
  const width = Math.min(maxW, maxH * ratio);
  return { width: Math.round(width), height: Math.round(width / ratio) };
}

function loadRatio(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : undefined);
    img.onerror = () => resolve(undefined);
    img.src = url;
  });
}

/** A picture's shape (width / height), once it has loaded; cards take it, so wide and tall screenshots both read well. */
export function usePictureRatio(path: string | undefined): number | undefined {
  const url = usePictureUrl(path);
  const [ratio, setRatio] = useState<{ url: string; ratio?: number }>();
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    markBusy();
    void loadRatio(url).then((r) => { if (!cancelled) setRatio({ url, ratio: r }); }).finally(markDone);
    return () => { cancelled = true; };
  }, [url]);
  return ratio && ratio.url === url ? ratio.ratio : undefined;
}

/** The shapes of several pictures, by path; null until every one has loaded (a diagram is laid out once). */
export function usePictureRatios(paths: string[]): Map<string, number> | null {
  const { picture, product } = useApp();
  const key = `${product.loadedAt}:${[...new Set(paths)].join('|')}`;
  const [ratios, setRatios] = useState<{ key: string; map: Map<string, number> }>();
  useEffect(() => {
    let cancelled = false;
    markBusy();
    const unique = [...new Set(paths)];
    void Promise.all(unique.map(async (p) => [p, await picture(p).then(loadRatio).catch(() => undefined)] as const))
      .then((entries) => { if (!cancelled) setRatios({ key, map: new Map(entries.filter((e): e is [string, number] => e[1] !== undefined)) }); })
      .finally(markDone);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return ratios?.key === key ? ratios.map : null;
}

export function Picture({ path, ...props }: { path: string } & ImgHTMLAttributes<HTMLImageElement>) {
  const url = usePictureUrl(path);
  return url ? <img src={url} draggable={false} {...props} /> : <div className={props.className} />;
}
