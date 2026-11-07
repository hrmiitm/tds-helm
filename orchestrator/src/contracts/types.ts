/**
 * Studio Universal Orchestrator Contracts & DTOs
 * Reference: upgrade.md Sections 2.1, 2.2, 3, 4.1-4.4
 */

export enum LifecycleState {
  NOT_STARTED = 'NOT_STARTED',
  PREPARING = 'PREPARING',
  STARTING = 'STARTING',
  RUNNING = 'RUNNING',
  STOPPING = 'STOPPING',
  STOPPED = 'STOPPED',
  RESETTING = 'RESETTING',
  ERROR = 'ERROR',
  UNKNOWN = 'UNKNOWN',
}

export type StudioRole = 'chapter' | 'hub' | 'seed' | 'content' | 'state' | 'network' | 'lock';

export const STUDIO_LABEL_KEYS = {
  MANAGED: 'io.studio.managed',
  INSTALLATION: 'io.studio.installation',
  ROLE: 'io.studio.role',
  CHAPTER: 'io.studio.chapter',
  GENERATION: 'io.studio.generation',
  CONTENT: 'io.studio.content',
} as const;

export interface StudioLabels {
  [STUDIO_LABEL_KEYS.MANAGED]: 'true';
  [STUDIO_LABEL_KEYS.INSTALLATION]: string;
  [STUDIO_LABEL_KEYS.ROLE]: StudioRole;
  [STUDIO_LABEL_KEYS.CHAPTER]?: string;
  [STUDIO_LABEL_KEYS.GENERATION]?: string;
  [STUDIO_LABEL_KEYS.CONTENT]?: string;
  [key: string]: string | undefined;
}

export const RESOURCE_CEILINGS = {
  MAX_CPUS: 2,
  MAX_CPU_MILLI: 2000,
  MAX_MEMORY_MIB: 3072,
  MAX_MEMORY_BYTES: 3072 * 1024 * 1024,
  MAX_PIDS: 256,
  DEFAULT_STOP_GRACE_SECONDS: 15,
} as const;

export interface ResourceRequirements {
  cpuMilli: number;
  memoryMiB: number;
  diskMiB?: number;
  startupSeconds?: number;
}

export interface ContainerResourceLimits {
  cpuMilli: number;
  memoryBytes: number;
  memorySwapBytes?: number;
  pidsLimit?: number;
}

export interface ChapterMetadata {
  id: string;
  version: string;
  title: string;
  badge?: string;
  description: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced' | string;
  estimatedMinutes?: number;
  authors?: string[];
  tags?: string[];
  license?: string;
  tasks?: number;
  moduleCount?: number;
}

export interface ChapterRuntimeConfig {
  profile?: string;
  image: string;
  architectures?: string[];
  tools: string[];
  optionalTools?: string[];
  network?: 'offline' | 'egress' | string;
  resources: ResourceRequirements;
  startupSeconds?: number;
  previewPorts?: number[];
  env?: Record<string, string>;
}

export interface ChapterContentConfig {
  tasks: string;
  slides: string;
  workspace: string;
}

export interface ChapterModule {
  id: string;
  title: string;
  taskIds?: string[];
  slideIds?: string[];
  defaultTool?: string;
  prerequisites?: string[];
  estimatedMinutes?: number;
}

export interface Chapter {
  id: string;
  version: string;
  title: string;
  description: string;
  badge?: string;
  metadata: ChapterMetadata;
  runtime: ChapterRuntimeConfig;
  content: ChapterContentConfig;
  modules: ChapterModule[];
  state?: LifecycleState;
  observedState?: LifecycleState;
  activeGeneration?: number;
  contentDigest?: string;
  lastError?: string;
  tasks?: number;
  moduleCount?: number;
  estimatedMinutes?: number;
}

export interface PortMapping {
  hostIp?: string;
  hostPort: number;
  containerPort: number;
  protocol?: 'tcp' | 'udp';
}

export interface RuntimeSnapshot {
  id: string;
  name: string;
  state: LifecycleState;
  rawStatus: string;
  installationId: string;
  role: StudioRole;
  chapterId?: string;
  generation?: number;
  labels: Record<string, string>;
  ports: PortMapping[];
  assignedEphemeralPort?: number;
  ipAddress?: string;
  networkName?: string;
  created: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  oomKilled?: boolean;
  healthStatus?: 'healthy' | 'unhealthy' | 'starting' | 'none';
}

export interface EngineCapabilities {
  engineType: 'docker' | 'podman';
  version: string;
  apiVersion: string;
  os: string;
  arch: string;
  cgroupVersion: 'v1' | 'v2' | string;
  supportsCpuLimits: boolean;
  supportsMemoryLimits: boolean;
  supportsSwapLimits: boolean;
  supportsPidsLimit: boolean;
  supportsNoCopyMounts: boolean;
  isRootless: boolean;
  endpoint: string;
  availableMemoryBytes?: number;
  availableCpus?: number;
}

export type OperationType = 'launch' | 'stop' | 'restart' | 'reset' | 'migration' | 'uninstall';
export type OperationStatus = 'pending' | 'in_progress' | 'succeeded' | 'failed' | 'cancelled';

export interface OperationRecord {
  operationId: string;
  idempotencyKey?: string;
  type: OperationType;
  chapterId: string;
  phase: string;
  status: OperationStatus;
  targetRevision: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: {
    code: StudioErrorCode;
    message: string;
    retryable: boolean;
    details?: unknown;
  };
  result?: Record<string, unknown>;
}

export interface ResetToken {
  token: string;
  installationId: string;
  chapterId: string;
  epoch: number;
  volumeIds: string[];
  resetScope: 'workspace_and_home' | string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

export interface VolumeMountSpec {
  source: string;
  target: string;
  readOnly?: boolean;
  type?: 'volume' | 'bind' | 'tmpfs';
  noCopy?: boolean;
}

export interface PortBindingSpec {
  containerPort: number;
  hostPort?: number;
  hostIp?: string;
  protocol?: 'tcp' | 'udp';
}

export interface ContainerSpec {
  name: string;
  image: string;
  installationId: string;
  chapterId: string;
  role: StudioRole;
  generation: number;
  labels?: Record<string, string>;
  env?: Record<string, string>;
  volumes: VolumeMountSpec[];
  portBindings?: PortBindingSpec[];
  network?: string;
  networkAliases?: string[];
  resources: ContainerResourceLimits;
  stopGraceSeconds?: number;
  readOnlyRootFilesystem?: boolean;
  user?: string;
  init?: boolean;
  command?: string[];
  entrypoint?: string[];
}

export type ValidatedContainerSpec = ContainerSpec;

export interface VolumeRecord {
  name: string;
  driver: string;
  labels: Record<string, string>;
  mountpoint?: string;
  scope?: string;
  created?: string;
}

export interface NetworkRecord {
  id: string;
  name: string;
  driver: string;
  labels: Record<string, string>;
  internal: boolean;
  subnet?: string;
  gateway?: string;
}

export interface ImageDigest {
  id: string;
  digest: string;
  repoTags?: string[];
}

export interface ApprovedImageRef {
  image: string;
  expectedDigest?: string;
  buildContext?: string;
}

export interface OwnedVolumeSpec {
  name: string;
  installationId: string;
  role: StudioRole;
  chapterId?: string;
  labels?: Record<string, string>;
  driver?: string;
}

export interface OwnedNetworkSpec {
  name: string;
  installationId: string;
  role: StudioRole;
  labels?: Record<string, string>;
  internal?: boolean;
}

export interface SafeContentArchive {
  destinationPath: string;
  content: Buffer | NodeJS.ReadableStream;
}

export interface LogChunk {
  stream: 'stdout' | 'stderr';
  data: string;
  timestamp?: string;
}

export interface EngineEvent {
  type: 'container' | 'volume' | 'network' | 'daemon';
  action: string;
  actor: {
    id: string;
    attributes: Record<string, string>;
  };
  time: number;
}

export enum StudioErrorCode {
  ENGINE_UNAVAILABLE = 'ENGINE_UNAVAILABLE',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  UNSUPPORTED_CAPABILITY = 'UNSUPPORTED_CAPABILITY',
  NAME_CONFLICT = 'NAME_CONFLICT',
  PORT_IN_USE = 'PORT_IN_USE',
  IMAGE_UNAVAILABLE = 'IMAGE_UNAVAILABLE',
  RESOURCE_LIMIT_UNENFORCEABLE = 'RESOURCE_LIMIT_UNENFORCEABLE',
  DISK_FULL = 'DISK_FULL',
  SEED_FAILED = 'SEED_FAILED',
  READINESS_TIMEOUT = 'READINESS_TIMEOUT',
  STOP_FAILED = 'STOP_FAILED',
  STALE_REVISION = 'STALE_REVISION',
  RESET_INCOMPLETE = 'RESET_INCOMPLETE',
}
