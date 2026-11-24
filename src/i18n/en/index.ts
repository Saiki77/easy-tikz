/*
 * English: the source of every text and the fallback of every other
 * language (see src/i18n/index.ts). One file per part of the plugin, so each
 * part can be translated and checked on its own; every key starts with the
 * name of its file.
 */
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

export const EN = { ...common, ...editor, ...build, ...panels, ...plugin, ...problems, ...help, ...beyond, ...motion6, ...notes6 };

export type MessageKey = keyof typeof EN;
