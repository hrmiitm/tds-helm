/**
 * Engine Error Classification and Mapping
 * Reference: upgrade.md Section 4.2
 */
import { EngineError } from '../contracts';
export declare function mapEngineError(err: unknown, defaultMessage?: string): EngineError;
