<script setup>
import { nextTick, ref, watch } from 'vue';
import {
  deleteGuardState,
  submitDeleteGuard,
  cancelDeleteGuard,
} from '../composables/useDeleteGuard.js';

const inputRef = ref(null);

watch(
  () => deleteGuardState.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    inputRef.value?.focus();
  }
);

function onBackdrop(e) {
  if (e.target === e.currentTarget) cancelDeleteGuard();
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="deleteGuardState.open"
      class="delete-guard"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-guard-title"
      @click="onBackdrop"
      @keydown.esc="cancelDeleteGuard"
    >
      <div class="delete-guard__dialog">
        <div class="delete-guard__head">
          <span id="delete-guard-title" class="delete-guard__title">Delete protection</span>
          <span class="delete-guard__meta">CONFIRM</span>
        </div>

        <p class="delete-guard__copy">
          You are about to delete
          <strong v-if="deleteGuardState.target">“{{ deleteGuardState.target }}”</strong>
          <span v-else>this item</span>.
          This cannot be undone.
        </p>

        <label class="delete-guard__label" for="delete-guard-password">
          What is the author's birthday?
        </label>
        <input
          id="delete-guard-password"
          ref="inputRef"
          v-model="deleteGuardState.value"
          class="delete-guard__input"
          type="password"
          autocomplete="off"
          spellcheck="false"
          placeholder="Password (YYYY-MM-DD)"
          @keyup.enter="submitDeleteGuard"
          @input="deleteGuardState.error = ''"
        />

        <p v-if="deleteGuardState.error" class="delete-guard__error">
          {{ deleteGuardState.error }}
        </p>

        <div class="delete-guard__actions">
          <button type="button" class="btn btn-secondary" @click="cancelDeleteGuard">
            Cancel
          </button>
          <button type="button" class="btn btn-danger" @click="submitDeleteGuard">
            Delete
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.delete-guard {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.62);
}

.delete-guard__dialog {
  width: min(440px, 100%);
  border: 1px solid var(--text-primary);
  background: var(--bg);
  color: var(--text-primary);
  padding: 22px 24px 20px;
}

.delete-guard__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.delete-guard__title {
  font-family: var(--font-display);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.delete-guard__meta {
  font-family: var(--font-mono);
  font-size: 0.52rem;
  letter-spacing: 0.16em;
  color: var(--text-secondary);
}

.delete-guard__copy {
  margin: 18px 0 20px;
  font-size: 0.82rem;
  line-height: 1.65;
  color: var(--text-secondary);
}

.delete-guard__copy strong {
  color: var(--text-primary);
  font-weight: 500;
}

.delete-guard__label {
  display: block;
  margin-bottom: 8px;
  font-family: var(--font-mono);
  font-size: 0.56rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.delete-guard__input {
  width: 100%;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
}

.delete-guard__input:focus {
  outline: none;
  border-color: var(--text-primary);
}

.delete-guard__error {
  margin: 10px 0 0;
  font-family: var(--font-mono);
  font-size: 0.56rem;
  letter-spacing: 0.04em;
  color: var(--danger, #c0392b);
}

.delete-guard__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}

.delete-guard__actions .btn {
  min-height: 34px;
  padding: 0 16px;
  font-size: 0.55rem;
}

@media (max-width: 600px) {
  .delete-guard__actions {
    flex-direction: column-reverse;
  }
  .delete-guard__actions .btn {
    width: 100%;
    min-height: 44px;
  }
}
</style>
