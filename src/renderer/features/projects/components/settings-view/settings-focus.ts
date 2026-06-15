import { makeAutoObservable } from 'mobx';

/** A field group the project settings page can be asked to scroll to and focus. */
export type SettingsFocusTarget = 'docs';

/**
 * One-shot request to focus a section of the project settings page. Set by
 * deep links into settings (e.g. the Docs page's "configure" empty state) and
 * consumed by the matching settings section once it renders — works whether the
 * settings tab was already open or freshly navigated to.
 */
class SettingsFocusStore {
  target: SettingsFocusTarget | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  request(target: SettingsFocusTarget): void {
    this.target = target;
  }

  consume(): void {
    this.target = null;
  }
}

export const settingsFocus = new SettingsFocusStore();
