/*
 * 日本語 (Japanese): every key of src/i18n/en, one file per part like the
 * English. The compiler refuses a missing key; tests/i18n.test.ts checks that
 * every translation keeps the named places of its English text.
 */
import type { Messages } from '../types';
import type { EN } from '../en';
import { common } from './common';
import { editor } from './editor';
import { build } from './build';
import { panels } from './panels';
import { plugin } from './plugin';
import { problems } from './problems';
import { help } from './help';
import { beyond } from './beyond';
import { motion6 } from './motion6'; // 6.0 C
// 6.0 B
import { notes6 } from './notes6';
// 6.0 A
import { values } from './values';

export const JA: Messages<typeof EN> = { ...common, ...editor, ...build, ...panels, ...plugin, ...problems, ...help, ...beyond, ...motion6, ...notes6, ...values };
