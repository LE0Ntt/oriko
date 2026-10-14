import { setIcon } from "obsidian";

/**
 * The clip beside the palette: its media playing, its title, its labels, and
 * any labels about to be added. Display only. The media is replaced only when
 * the clip changes, so the palette re-rendering on every keystroke never
 * restarts a video.
 */

export interface ClipMedia {
  kind: "image" | "video";
  src: string;
  poster: string;
}

export interface ClipView {
  path: string;
  title: string;
  labels: string[];
  adding: string[];
  badge: string;
  canStep: boolean;
}

export class ClipPanel {
  private el: HTMLElement;
  private mediaEl: HTMLElement;
  private badgeEl: HTMLElement;
  private metaEl: HTMLElement;
  private shownPath: string | null = null;

  constructor(
    container: HTMLElement,
    private deps: { media: (path: string) => ClipMedia | null; onStep: (delta: 1 | -1) => void }
  ) {
    this.el = container.createDiv({ cls: "pg-clip-panel" });
    const frame = this.el.createDiv({ cls: "pg-clip-panel-frame" });
    this.mediaEl = frame.createDiv({ cls: "pg-clip-panel-media" });
    this.badgeEl = frame.createDiv({ cls: "pg-clip-panel-badge" });
    const steps: Array<[string, string, 1 | -1]> = [
      ["is-prev", "chevron-left", -1],
      ["is-next", "chevron-right", 1],
    ];
    for (const [cls, icon, delta] of steps) {
      const button = frame.createDiv({ cls: `pg-clip-panel-step ${cls}` });
      setIcon(button, icon);
      button.onclick = (event: MouseEvent) => {
        event.stopPropagation();
        this.deps.onStep(delta);
      };
    }
    this.metaEl = this.el.createDiv({ cls: "pg-clip-panel-meta" });
  }

  show(view: ClipView): void {
    this.el.addClass("is-visible");
    this.el.toggleClass("can-step", view.canStep);
    this.badgeEl.setText(view.badge);
    this.badgeEl.toggleClass("is-empty", view.badge === "");
    if (view.path !== this.shownPath) {
      this.shownPath = view.path;
      this.paintMedia(view.path);
    }
    this.metaEl.empty();
    this.metaEl.createDiv({ cls: "pg-clip-panel-title", text: view.title });
    const pills = this.metaEl.createDiv({ cls: "pg-clip-panel-labels" });
    for (const label of view.labels) pills.createSpan({ cls: "pg-clip-panel-pill", text: label });
    for (const label of view.adding) {
      if (!view.labels.includes(label)) pills.createSpan({ cls: "pg-clip-panel-pill is-adding", text: `+ ${label}` });
    }
  }

  hide(): void {
    if (!this.el.hasClass("is-visible")) return;
    this.el.removeClass("is-visible");
    this.stopMedia();
    this.mediaEl.empty();
    this.shownPath = null;
  }

  destroy(): void {
    this.hide();
    this.el.remove();
  }

  private paintMedia(path: string): void {
    this.stopMedia();
    this.mediaEl.empty();
    const media = this.deps.media(path);
    if (!media) {
      this.mediaEl.createDiv({ cls: "pg-clip-panel-empty", text: "No media for this clipping" });
      return;
    }
    if (media.kind === "video") {
      const video = this.mediaEl.createEl("video");
      video.muted = true;
      video.loop = true;
      video.autoplay = true;
      video.playsInline = true;
      if (media.poster) video.poster = media.poster;
      video.src = media.src;
      void video.play().catch(() => undefined);
    } else {
      const image = this.mediaEl.createEl("img");
      image.decoding = "async";
      image.src = media.src;
    }
  }

  private stopMedia(): void {
    const video = this.mediaEl.querySelector("video");
    if (!video) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
}
