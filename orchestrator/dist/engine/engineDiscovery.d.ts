/**
 * Engine Endpoint Discovery
 * Reference: upgrade.md Section 4.2
 */
export interface DiscoveredEndpoint {
    engineType: 'docker' | 'podman';
    transport: 'socket' | 'named_pipe' | 'tcp';
    endpoint: string;
    cliPath?: string;
    isRootless: boolean;
}
export interface DiscoveryOptions {
    preferredEngine?: 'docker' | 'podman';
    explicitEndpoint?: string;
    explicitCliPath?: string;
}
export declare function findCliPath(binaryName: 'docker' | 'podman'): Promise<string | undefined>;
export declare function discoverEngine(options?: DiscoveryOptions): Promise<DiscoveredEndpoint>;
export declare function normalizeEndpoint(endpoint: string): string;
