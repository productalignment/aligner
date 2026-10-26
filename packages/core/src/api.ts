import type { Finding, ItemType, Model } from './context/types.ts';

/** A product: a branch of its GitHub repository (`owner/name`). */
export interface ProductRef { repo: string; branch: string }

export interface ProductSnapshot extends ProductRef {
  /** False when the branch has no product/product.md yet (the UI offers to add one). */
  hasContext: boolean;
  /** When this snapshot was read; used to bust cached screen pictures. */
  loadedAt: number;
  name: string;
  model: Model;
  findings: Finding[];
  /** Changes whenever a file in product/ changes, so the coding agent's commits show up. */
  version: string;
  /**
   * Where the PM placed each flow's steps on its canvas, by flow ID, and the screens on the
   * map, under `screens`. Without one, a canvas is laid out automatically.
   */
  layouts: Record<string, Layout>;
  /**
   * How the PM drew each flow's connectors, by flow ID, and the arrows on the map, under `screens`;
   * one missing is drawn as Aligner draws it.
   */
  lines: Record<string, Lines>;
}

/**
 * Positions on a canvas by item ID, written by Aligner only: a flow's steps (`flows/FL-nnn.layout.json`)
 * or the screens on the map (`screens.layout.json`).
 */
export type Layout = Record<string, { x: number; y: number }>;

/**
 * How a connector or an arrow on the map is drawn, as on a whiteboard, written by Aligner only
 * in `flows/FL-nnn.lines.json` by connection ID, or `screens.lines.json` by link ID: its shape, where
 * each end is glued on its step or screen (in fractions of its box: one of its four dots, or a point
 * on its border; none: the side facing the other end), and a point the PM bent it through.
 */
export interface Line {
  shape?: 'curved' | 'elbow' | 'straight';
  from?: { x: number; y: number };
  to?: { x: number; y: number };
  via?: { x: number; y: number };
}
export type Lines = Record<string, Line>;

/** A PM edit. The server applies it to the product context files. */
export type EditOp =
  | { op: 'modify'; id: string; fields: Record<string, unknown> }
  | {
      op: 'add'; type: ItemType; fields: Record<string, unknown>; parent?: string; after?: string | null;
      /** A new step: a step to connect from, as a connector drawn to the new step (never put in between). */
      link?: string;
      /**
       * A new step or screen: where it goes on its canvas, with the positions of the others there
       * (`layout`), so the canvas keeps them all; a new link: the positions on the map.
       */
      at?: { x: number; y: number };
      layout?: Layout;
      /** A new screen: the step it is shown on. */
      on?: string;
      /** A new screen: the click zone on another screen that opens it. */
      zone?: { screen: string; box: string };
    }
  | { op: 'remove'; id: string };

export interface EditResult { snapshot: ProductSnapshot; id: string }

/** A screen's mockup as the PM drew it, stored in screens/SC-nnn.shapes.json. */
export interface Markup {
  /** The page the mockup is drawn on, at (0, 0): a blank phone or laptop screen, or the screenshot. */
  frame: { kind: 'phone' | 'laptop' | 'screenshot'; width: number; height: number };
  /** Back to front. They can also sit beside the frame, as notes in its margin. */
  shapes: Shape[];
}
export interface Paint { color: string; opacity: number }
export interface Stroke extends Paint { width: number; style: 'solid' | 'dashed' | 'dotted' }
export type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; fill: Paint; stroke: Stroke; radius: number }
  | { kind: 'ellipse'; x: number; y: number; w: number; h: number; fill: Paint; stroke: Stroke }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: Stroke }
  /**
   * `w` set: the text wraps at that width; unset: it is as wide as its longest line. A `note` is a
   * sticky note: the text on a yellow square `w` wide, a quick note to the coding agent.
   */
  | { kind: 'text'; x: number; y: number; w?: number; text: string; font: string; size: number; color: string; bold?: boolean; italic?: boolean; underline?: boolean; note?: boolean }
  /** A lucide icon, by name. */
  | { kind: 'icon'; x: number; y: number; w: number; h: number; name: string; color: string }
  /** A pasted picture, as a data URL. */
  | { kind: 'image'; x: number; y: number; w: number; h: number; src: string };

/** What the product's own code says about how it looks, for drawing mockups in its style. */
export interface ProductTheme {
  /** Its colour tokens, by name. */
  colours: { name: string; value: string }[];
  /** Its font families, the body's first. */
  fonts: string[];
  /** Stylesheets that load those fonts (Google Fonts links). */
  fontLinks: string[];
  /** The lucide icons its code imports. */
  icons: string[];
}

/** Where the PM is on their way to their products. */
export type Account =
  /**
   * Aligner has no GitHub app yet. The PM creates one by posting `manifest` to GitHub (`github`),
   * with `state`; once they have, `created` holds the variables to give Railway.
   */
  | { stage: 'setup'; github: string; state: string; manifest: string; created?: { name: string; variables: string } }
  | { stage: 'signin' }
  /**
   * Signed in; `install` is where the PM chooses the repositories Aligner can open. `durable`: drafts
   * outlive a restart of Aligner (it has a volume). `version` is this Aligner's, and `update` says
   * when a newer one is out.
   */
  | { stage: 'ready'; user: User; install: string; durable: boolean; version: string; update?: Update };

/** A newer version of Aligner: what it brings, and the PM's copy of Aligner, which one click brings up to date. */
export interface Update { version: string; notes: string[]; copy?: string }

export interface User { login: string; name: string | null; avatar: string }
/** A repository the PM can push to. */
export interface Repo { repo: string; defaultBranch: string; private: boolean; pushedAt: string | null }

/** The version of the files, for live refresh, and the PM's draft. */
export interface DraftStatus {
  version: string;
  /** How many things the draft changes; 0 when everything is committed. */
  changes: number;
  /** What moving the draft onto a push kept or lost. */
  notice?: string;
}

/** What the UI asks the Aligner server to do. */
export interface AlignerApi {
  account(): Promise<Account>;
  repos(): Promise<Repo[]>;
  /** The repository's branches, its default branch first. */
  branches(repo: string): Promise<string[]>;
  /** A new branch at the product's branch, with the PM's draft moved to it; resolves to its name. */
  createBranch(p: ProductRef, name: string): Promise<string>;
  snapshot(p: ProductRef): Promise<ProductSnapshot>;
  initProduct(p: ProductRef): Promise<ProductSnapshot>;
  edit(p: ProductRef, op: EditOp): Promise<EditResult>;
  setPicture(p: ProductRef, screenId: string, fileName: string, dataBase64: string): Promise<EditResult>;
  picture(p: ProductRef, path: string): Promise<string>;
  /** The shapes drawn over a screen, or null when it has no mockup. */
  markup(p: ProductRef, screenId: string): Promise<Markup | null>;
  /** Saves where a flow's steps (`of`: its ID) or the map's screens (`of`: `screens`) are; null goes back to the automatic layout. */
  saveLayout(p: ProductRef, of: string, layout: Layout | null): Promise<ProductSnapshot>;
  /** Saves how a flow's connectors (`of`: its ID) or the map's arrows (`of`: `screens`) are drawn; none removes the file. */
  saveLines(p: ProductRef, of: string, lines: Lines): Promise<ProductSnapshot>;
  /** Saves the shapes and the flattened mockup picture; no shapes removes the mockup. */
  saveMockup(p: ProductRef, screenId: string, markup: Markup, pngBase64: string): Promise<EditResult>;
  /** The product's colours, fonts and icons, read from its code. */
  theme(p: ProductRef): Promise<ProductTheme>;
  /** Cheap change detection, and the PM's draft. */
  status(p: ProductRef): Promise<DraftStatus>;
  /** Commits the draft to the branch as one commit; an empty message says what changed. */
  commit(p: ProductRef, message: string): Promise<ProductSnapshot>;
  /** Lets go of the draft. */
  discard(p: ProductRef): Promise<ProductSnapshot>;
  /** Brings the PM's copy of Aligner up to date with the original. */
  update(): Promise<void>;
}
