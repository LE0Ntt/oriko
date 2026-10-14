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
    this.image?.removeAttribute("src");
    this.shownPath = null;
  }

  destroy(): void {
    this.hide();
    this.el.remove();
  }

  /**
   * One video element and one image element for the panel's whole life,
   * with only their sources swapped. Making a new video for every clip had
   * the compositor rebuild its layers on each Tab, about 25 ms a step.
   */
  private video: HTMLVideoElement | null = null;
  private image: HTMLImageElement | null = null;
  private empty: HTMLElement | null = null;

  private paintMedia(path: string): void {
    const media = this.deps.media(path);
    if (!media) {
      this.stopMedia();
      this.image?.addClass("is-hidden");
      this.empty ??= this.mediaEl.createDiv({ cls: "pg-clip-panel-empty", text: "No media for this clipping" });
      this.empty.removeClass("is-hidden");
      return;
    }
    this.empty?.addClass("is-hidden");

    if (media.kind === "video") {
      this.image?.addClass("is-hidden");
      const video = (this.video ??= this.makeVideo());
      video.removeClass("is-hidden");
      if (media.poster) video.poster = media.poster;
      else video.removeAttribute("poster");
      video.src = media.src;
      void video.play().catch(() => undefined);
    } else {
      this.stopMedia();
      const image = (this.image ??= this.mediaEl.createEl("img"));
      image.decoding = "async";
      image.removeClass("is-hidden");
      image.src = media.src;
    }
  }

  private makeVideo(): HTMLVideoElement {
    const video = this.mediaEl.createEl("video");
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    return video;
  }

  /** Stops the video and lets go of its decoder; the element stays for the next clip. */
  private stopMedia(): void {
    const video = this.video;
    if (!video) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.addClass("is-hidden");
  }
}
