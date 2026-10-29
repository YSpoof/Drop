class LazyLoad {
  #loaded = $state<Record<string, true>>({});

  mark(key: string) {
    if (!this.#loaded[key]) {
      this.#loaded = { ...this.#loaded, [key]: true };
    }
  }

  has(key: string) {
    return this.#loaded[key] === true;
  }
}

export const lazyLoad = new LazyLoad();
