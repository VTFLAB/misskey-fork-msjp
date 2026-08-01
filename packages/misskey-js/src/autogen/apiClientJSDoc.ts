import type { SwitchCaseResponseType } from '../api.js';
import type { Endpoints } from '../api.types.js';

declare module '../api.js' {
  export interface APIClient {
    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes* / **Permission**: *write:admin:abuse-report:notification-recipient*
     */
    request<E extends 'admin/abuse-report/notification-recipient/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes* / **Permission**: *write:admin:abuse-report:notification-recipient*
     */
    request<E extends 'admin/abuse-report/notification-recipient/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes* / **Permission**: *read:admin:abuse-report:notification-recipient*
     */
    request<E extends 'admin/abuse-report/notification-recipient/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes* / **Permission**: *read:admin:abuse-report:notification-recipient*
     */
    request<E extends 'admin/abuse-report/notification-recipient/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes* / **Permission**: *write:admin:abuse-report:notification-recipient*
     */
    request<E extends 'admin/abuse-report/notification-recipient/update', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:abuse-user-reports*
     */
    request<E extends 'admin/abuse-user-reports', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'admin/accounts/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:account*
     */
    request<E extends 'admin/accounts/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:account*
     */
    request<E extends 'admin/accounts/find-by-email', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:ad*
     */
    request<E extends 'admin/ad/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:ad*
     */
    request<E extends 'admin/ad/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:ad*
     */
    request<E extends 'admin/ad/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:ad*
     */
    request<E extends 'admin/ad/update', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:announcements*
     */
    request<E extends 'admin/announcements/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:announcements*
     */
    request<E extends 'admin/announcements/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:announcements*
     */
    request<E extends 'admin/announcements/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:announcements*
     */
    request<E extends 'admin/announcements/update', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:avatar-decorations*
     */
    request<E extends 'admin/avatar-decorations/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:avatar-decorations*
     */
    request<E extends 'admin/avatar-decorations/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:avatar-decorations*
     */
    request<E extends 'admin/avatar-decorations/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:avatar-decorations*
     */
    request<E extends 'admin/avatar-decorations/update', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:meta*
     */
    request<E extends 'admin/captcha/current', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:meta*
     */
    request<E extends 'admin/captcha/save', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:delete-account*
     */
    request<E extends 'admin/delete-account', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:delete-all-files-of-a-user*
     */
    request<E extends 'admin/delete-all-files-of-a-user', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:drive*
     */
    request<E extends 'admin/drive/clean-remote-files', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:drive*
     */
    request<E extends 'admin/drive/cleanup', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:drive*
     */
    request<E extends 'admin/drive/files', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:drive*
     */
    request<E extends 'admin/drive/show-file', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:emoji*
     */
    request<E extends 'admin/emoji/add', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:emoji*
     */
    request<E extends 'admin/emoji/add-aliases-bulk', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:emoji*
     */
    request<E extends 'admin/emoji/copy', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:emoji*
     */
    request<E extends 'admin/emoji/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:emoji*
     */
    request<E extends 'admin/emoji/delete-bulk', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'admin/emoji/import-zip', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:emoji*
     */
    request<E extends 'admin/emoji/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:emoji*
     */
    request<E extends 'admin/emoji/list-remote', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:emoji*
     */
    request<E extends 'admin/emoji/remove-aliases-bulk', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:emoji*
     */
    request<E extends 'admin/emoji/set-aliases-bulk', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:emoji*
     */
    request<E extends 'admin/emoji/set-category-bulk', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:emoji*
     */
    request<E extends 'admin/emoji/set-license-bulk', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:emoji*
     */
    request<E extends 'admin/emoji/update', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:federation*
     */
    request<E extends 'admin/federation/delete-all-files', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:federation*
     */
    request<E extends 'admin/federation/refresh-remote-instance-metadata', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:federation*
     */
    request<E extends 'admin/federation/remove-all-following', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:federation*
     */
    request<E extends 'admin/federation/update-instance', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:resolve-abuse-user-report*
     */
    request<E extends 'admin/forward-abuse-user-report', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:index-stats*
     */
    request<E extends 'admin/get-index-stats', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:table-stats*
     */
    request<E extends 'admin/get-table-stats', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:user-ips*
     */
    request<E extends 'admin/get-user-ips', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:invite-codes*
     */
    request<E extends 'admin/invite/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:invite-codes*
     */
    request<E extends 'admin/invite/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:meta*
     */
    request<E extends 'admin/meta', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:promo*
     */
    request<E extends 'admin/promo/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:queue*
     */
    request<E extends 'admin/queue/clear', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:queue*
     */
    request<E extends 'admin/queue/deliver-delayed', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:queue*
     */
    request<E extends 'admin/queue/inbox-delayed', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:queue*
     */
    request<E extends 'admin/queue/jobs', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:queue*
     */
    request<E extends 'admin/queue/pause', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:queue*
     */
    request<E extends 'admin/queue/promote-jobs', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:queue*
     */
    request<E extends 'admin/queue/queue-stats', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:queue*
     */
    request<E extends 'admin/queue/queues', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:queue*
     */
    request<E extends 'admin/queue/remove-job', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:queue*
     */
    request<E extends 'admin/queue/resume', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:queue*
     */
    request<E extends 'admin/queue/retry-job', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:queue*
     */
    request<E extends 'admin/queue/show-job', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:queue*
     */
    request<E extends 'admin/queue/show-job-logs', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:queue*
     */
    request<E extends 'admin/queue/stats', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:relays*
     */
    request<E extends 'admin/relays/add', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:relays*
     */
    request<E extends 'admin/relays/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:relays*
     */
    request<E extends 'admin/relays/remove', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:reset-password*
     */
    request<E extends 'admin/reset-password', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:resolve-abuse-user-report*
     */
    request<E extends 'admin/resolve-abuse-user-report', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:roles*
     */
    request<E extends 'admin/roles/assign', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:roles*
     */
    request<E extends 'admin/roles/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:roles*
     */
    request<E extends 'admin/roles/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:roles*
     */
    request<E extends 'admin/roles/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:roles*
     */
    request<E extends 'admin/roles/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:roles*
     */
    request<E extends 'admin/roles/unassign', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:roles*
     */
    request<E extends 'admin/roles/update', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:roles*
     */
    request<E extends 'admin/roles/update-default-policies', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No* / **Permission**: *read:admin:roles*
     */
    request<E extends 'admin/roles/users', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:send-email*
     */
    request<E extends 'admin/send-email', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:server-info*
     */
    request<E extends 'admin/server-info', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:show-moderation-log*
     */
    request<E extends 'admin/show-moderation-logs', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:show-user*
     */
    request<E extends 'admin/show-user', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:show-user*
     */
    request<E extends 'admin/show-users', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:suspend-user*
     */
    request<E extends 'admin/suspend-user', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes* / **Permission**: *write:admin:system-webhook*
     */
    request<E extends 'admin/system-webhook/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes* / **Permission**: *write:admin:system-webhook*
     */
    request<E extends 'admin/system-webhook/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes* / **Permission**: *write:admin:system-webhook*
     */
    request<E extends 'admin/system-webhook/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes* / **Permission**: *write:admin:system-webhook*
     */
    request<E extends 'admin/system-webhook/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes* / **Permission**: *read:admin:system-webhook*
     */
    request<E extends 'admin/system-webhook/test', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes* / **Permission**: *write:admin:system-webhook*
     */
    request<E extends 'admin/system-webhook/update', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:unset-mfa*
     */
    request<E extends 'admin/unset-mfa', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:unset-user-avatar*
     */
    request<E extends 'admin/unset-user-avatar', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:unset-user-banner*
     */
    request<E extends 'admin/unset-user-banner', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:unsuspend-user*
     */
    request<E extends 'admin/unsuspend-user', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:resolve-abuse-user-report*
     */
    request<E extends 'admin/update-abuse-user-report', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:update-info*
     */
    request<E extends 'admin/update-info/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:update-info*
     */
    request<E extends 'admin/update-info/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:update-info*
     */
    request<E extends 'admin/update-info/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:update-info*
     */
    request<E extends 'admin/update-info/update', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:meta*
     */
    request<E extends 'admin/update-meta', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:account*
     */
    request<E extends 'admin/update-proxy-account', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:admin:user-note*
     */
    request<E extends 'admin/update-user-note', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'announcements', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'announcements/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'antennas/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'antennas/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'antennas/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'antennas/notes', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'antennas/remove-note', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'antennas/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'antennas/update', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:federation*
     */
    request<E extends 'ap/get', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'ap/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'app/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'app/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Bluesky pseudo-user の直近 N 日分の post を AppView (getAuthorFeed) から取り込む。既存 note は uri 重複で skip される。新規 follow 時は /api/atproto/follow が自動で呼ぶので、これは既存 follow 済アカウントを後から取り込むときや、cutoff を伸ばしたいときに使う。長時間 (~数分) かかる場合があるので背景実行に向く。
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'atproto/backfill', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Bluesky DID で識別される pseudo-user を upsert し follow する。新規 follow 完了後、Jetstream subscription を即時 refresh する。
     * 
     * **Credential required**: *Yes* / **Permission**: *write:following*
     */
    request<E extends 'atproto/follow', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Bluesky の actor を AppView 検索する (匿名アクセス、自前 PDS を持たない)。各結果には、現在のユーザーが該当 Bluesky pseudo-user を既に follow しているかが付く。
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'atproto/search', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Bluesky DID で識別される pseudo-user を unfollow する。pseudo-user 自体は残す (他 user の follow 対象になっている場合があるため)。
     * 
     * **Credential required**: *Yes* / **Permission**: *write:following*
     */
    request<E extends 'atproto/unfollow', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'auth/accept', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'auth/session/generate', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'auth/session/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'auth/session/userkey', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:blocks*
     */
    request<E extends 'blocking/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:blocks*
     */
    request<E extends 'blocking/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:blocks*
     */
    request<E extends 'blocking/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'bubble-game/ranking', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'bubble-game/register', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:channels*
     */
    request<E extends 'channels/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:channels*
     */
    request<E extends 'channels/favorite', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'channels/featured', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:channels*
     */
    request<E extends 'channels/follow', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:channels*
     */
    request<E extends 'channels/followed', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:channels*
     */
    request<E extends 'channels/mute/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:channels*
     */
    request<E extends 'channels/mute/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:channels*
     */
    request<E extends 'channels/mute/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:channels*
     */
    request<E extends 'channels/my-favorites', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:channels*
     */
    request<E extends 'channels/owned', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'channels/search', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'channels/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'channels/timeline', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:channels*
     */
    request<E extends 'channels/unfavorite', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:channels*
     */
    request<E extends 'channels/unfollow', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:channels*
     */
    request<E extends 'channels/update', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'charts/active-users', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'charts/ap-request', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'charts/drive', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'charts/federation', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'charts/instance', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'charts/notes', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'charts/user/drive', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'charts/user/following', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'charts/user/notes', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'charts/user/pv', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'charts/user/reactions', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'charts/users', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:chat*
     */
    request<E extends 'chat/history', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:chat*
     */
    request<E extends 'chat/messages/create-to-room', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:chat*
     */
    request<E extends 'chat/messages/create-to-user', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:chat*
     */
    request<E extends 'chat/messages/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:chat*
     */
    request<E extends 'chat/messages/react', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:chat*
     */
    request<E extends 'chat/messages/room-timeline', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:chat*
     */
    request<E extends 'chat/messages/search', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:chat*
     */
    request<E extends 'chat/messages/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:chat*
     */
    request<E extends 'chat/messages/unreact', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:chat*
     */
    request<E extends 'chat/messages/user-timeline', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:chat*
     */
    request<E extends 'chat/read-all', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:chat*
     */
    request<E extends 'chat/rooms/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:chat*
     */
    request<E extends 'chat/rooms/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:chat*
     */
    request<E extends 'chat/rooms/invitations/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:chat*
     */
    request<E extends 'chat/rooms/invitations/ignore', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:chat*
     */
    request<E extends 'chat/rooms/invitations/inbox', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:chat*
     */
    request<E extends 'chat/rooms/invitations/outbox', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:chat*
     */
    request<E extends 'chat/rooms/join', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:chat*
     */
    request<E extends 'chat/rooms/joining', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:chat*
     */
    request<E extends 'chat/rooms/leave', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:chat*
     */
    request<E extends 'chat/rooms/members', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:chat*
     */
    request<E extends 'chat/rooms/mute', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:chat*
     */
    request<E extends 'chat/rooms/owned', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:chat*
     */
    request<E extends 'chat/rooms/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:chat*
     */
    request<E extends 'chat/rooms/update', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'clips/add-note', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'clips/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'clips/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:clip-favorite*
     */
    request<E extends 'clips/favorite', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'clips/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:clip-favorite*
     */
    request<E extends 'clips/my-favorites', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No* / **Permission**: *read:account*
     */
    request<E extends 'clips/notes', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'clips/remove-note', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No* / **Permission**: *read:account*
     */
    request<E extends 'clips/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:clip-favorite*
     */
    request<E extends 'clips/unfavorite', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'clips/update', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:drive*
     */
    request<E extends 'drive', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:drive*
     */
    request<E extends 'drive/files', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:drive*
     */
    request<E extends 'drive/files/attached-chat-messages', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Find the notes to which the given file is attached.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:drive*
     */
    request<E extends 'drive/files/attached-notes', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Check if a given file exists.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:drive*
     */
    request<E extends 'drive/files/check-existence', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Upload a new drive file.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:drive*
     */
    request<E extends 'drive/files/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Delete an existing drive file.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:drive*
     */
    request<E extends 'drive/files/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Search for a drive file by the given parameters.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:drive*
     */
    request<E extends 'drive/files/find', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Search for a drive file by a hash of the contents.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:drive*
     */
    request<E extends 'drive/files/find-by-hash', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:drive*
     */
    request<E extends 'drive/files/move-bulk', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Show the properties of a drive file.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:drive*
     */
    request<E extends 'drive/files/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Update the properties of a drive file.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:drive*
     */
    request<E extends 'drive/files/update', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Request the server to download a new drive file from the specified URL.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:drive*
     */
    request<E extends 'drive/files/upload-from-url', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:drive*
     */
    request<E extends 'drive/folders', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:drive*
     */
    request<E extends 'drive/folders/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:drive*
     */
    request<E extends 'drive/folders/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:drive*
     */
    request<E extends 'drive/folders/find', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:drive*
     */
    request<E extends 'drive/folders/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:drive*
     */
    request<E extends 'drive/folders/update', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:drive*
     */
    request<E extends 'drive/stream', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'earthquake/history', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'email-address/available', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'emoji', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'emojis', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'endpoint', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'endpoints', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'export-custom-emojis', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'federation/followers', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'federation/following', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'federation/instances', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'federation/show-instance', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'federation/stats', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'federation/update-remote-user', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'federation/users', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'fetch-external-resources', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'fetch-rss', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:flash*
     */
    request<E extends 'flash/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:flash*
     */
    request<E extends 'flash/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'flash/featured', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:flash-likes*
     */
    request<E extends 'flash/like', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:flash*
     */
    request<E extends 'flash/my', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:flash-likes*
     */
    request<E extends 'flash/my-likes', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'flash/search', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'flash/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:flash-likes*
     */
    request<E extends 'flash/unlike', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:flash*
     */
    request<E extends 'flash/update', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:following*
     */
    request<E extends 'following/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:following*
     */
    request<E extends 'following/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:following*
     */
    request<E extends 'following/invalidate', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * List of following users
     * 
     * **Credential required**: *Yes* / **Permission**: *read:following*
     */
    request<E extends 'following/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:following*
     */
    request<E extends 'following/requests/accept', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:following*
     */
    request<E extends 'following/requests/cancel', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:following*
     */
    request<E extends 'following/requests/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:following*
     */
    request<E extends 'following/requests/reject', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:following*
     */
    request<E extends 'following/requests/sent', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:following*
     */
    request<E extends 'following/update', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:following*
     */
    request<E extends 'following/update-all', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'gallery/featured', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'gallery/popular', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'gallery/posts', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:gallery*
     */
    request<E extends 'gallery/posts/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:gallery*
     */
    request<E extends 'gallery/posts/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:gallery-likes*
     */
    request<E extends 'gallery/posts/like', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'gallery/posts/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:gallery-likes*
     */
    request<E extends 'gallery/posts/unlike', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:gallery*
     */
    request<E extends 'gallery/posts/update', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'get-avatar-decorations', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'get-online-users-count', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'get-weather', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * 配信アーカイブの Google Drive 連携、または YouTube アップロード追加認証の認可 URL を発行する。target=youtube の場合は既存の Drive 権限を維持したまま (incremental authorization) YouTube アップロード権限のみを追加要求する。
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'google-drive/generate-oauth-url', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * 自分の Google Drive 連携状態 (配信アーカイブ用) を返す。
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'google-drive/my-account', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * 配信アーカイブ (Google Drive) の処理状態を返す。processing 中は Drive 側のサムネイル生成状況を確認し、生成済みなら ready に更新してから返す (フロントエンドのポーリング契機)。
     * 
     * **Credential required**: *No*
     */
    request<E extends 'google-drive/recording-status', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * 配信アーカイブの Google 連携を解除する。target を指定すると Drive/YouTube 片方のみ解除する (target 省略時は両方まとめて解除・トークンも revoke)。
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'google-drive/unlink', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'hashtags/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'hashtags/search', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'hashtags/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'hashtags/trend', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'hashtags/users', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'i', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/2fa/done', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/2fa/key-done', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/2fa/password-less', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/2fa/register', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/2fa/register-key', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/2fa/remove-key', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/2fa/unregister', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/2fa/update-key', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/apps', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/authorized-apps', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/change-password', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'i/claim-achievement', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/delete-account', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/export-antennas', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/export-blocking', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/export-clips', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/export-favorites', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/export-following', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/export-mute', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/export-notes', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/export-user-lists', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:favorites*
     */
    request<E extends 'i/favorites', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:gallery-likes*
     */
    request<E extends 'i/gallery/likes', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:gallery*
     */
    request<E extends 'i/gallery/posts', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/import-antennas', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/import-blocking', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/import-following', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/import-muting', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/import-user-lists', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/move', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:notifications*
     */
    request<E extends 'i/notifications', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:notifications*
     */
    request<E extends 'i/notifications-grouped', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:page-likes*
     */
    request<E extends 'i/page-likes', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:pages*
     */
    request<E extends 'i/pages', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'i/pin', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'i/read-announcement', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/regenerate-token', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'i/registry/get', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'i/registry/get-all', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'i/registry/get-detail', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'i/registry/keys', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'i/registry/keys-with-type', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'i/registry/remove', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/registry/scopes-with-domain', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'i/registry/set', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Revoke an access token of the authenticated user. Requires credential. When called with an access token (third-party app), only the token currently in use can be revoked.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'i/revoke-token', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/signin-history', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'i/unpin', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'i/update', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'i/update-email', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'i/webhooks/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'i/webhooks/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'i/webhooks/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'i/webhooks/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'i/webhooks/test', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'i/webhooks/update', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:invite-codes*
     */
    request<E extends 'invite/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:invite-codes*
     */
    request<E extends 'invite/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:invite-codes*
     */
    request<E extends 'invite/limit', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:invite-codes*
     */
    request<E extends 'invite/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * ライブチャンネル (自己配信) 機能を有効化する。既に live_channel 行があれば ALREADY_EXISTS。
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'live-channels/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * 配信機能が有効な配信チャンネルの一覧を返す (`/live` の配信チャンネルタブ用)。MSJP配信・Twitch配信いずれの配信中状態も twitch_stream(isLive=true) を突合して isLive/startedAt に反映する。
     * 
     * **Credential required**: *No*
     */
    request<E extends 'live-channels/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * 自分のライブチャンネル設定を返す。未開設なら channel: null。OME 連携有効時は whipUrl を含む。
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'live-channels/my', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * ストリームキーを再生成する。旧キーは即座に無効化される。Phase 2 (OME 連携) では旧キーでの既存接続も強制切断するが、Phase 1 では乱数の入れ替えのみ行う。
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'live-channels/regenerate-key', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * 指定ユーザーのライブチャンネル設定を返す。チャンネル未開設 (live_channel 行が無い) 場合は NO_SUCH_CHANNEL。ストリームキー等の秘匿フィールドは本人がログインしている場合のみ返す。
     * 
     * **Credential required**: *No*
     */
    request<E extends 'live-channels/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * ライブチャンネル (自己配信) の設定 (有効/無効・チャンネル名・説明・バナー) を更新する。
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'live-channels/update', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * password モードの視聴制限があるライブチャンネルのパスワードを検証し、成功時に視聴トークンを発行する。匿名視聴者もパスワードで視聴可能にするため認証不要。
     * 
     * **Credential required**: *No*
     */
    request<E extends 'live-channels/verify-view-password', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'meta', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'miauth/gen-token', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:mutes*
     */
    request<E extends 'mute/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:mutes*
     */
    request<E extends 'mute/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:mutes*
     */
    request<E extends 'mute/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'my/apps', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'notes', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'notes/children', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'notes/clips', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'notes/conversation', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:notes*
     */
    request<E extends 'notes/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:notes*
     */
    request<E extends 'notes/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'notes/drafts/count', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'notes/drafts/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'notes/drafts/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'notes/drafts/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'notes/drafts/update', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:favorites*
     */
    request<E extends 'notes/favorites/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:favorites*
     */
    request<E extends 'notes/favorites/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'notes/featured', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'notes/global-timeline', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'notes/hybrid-timeline', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'notes/local-timeline', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'notes/mentions', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'notes/polls/recommendation', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:votes*
     */
    request<E extends 'notes/polls/vote', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'notes/reactions', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:reactions*
     */
    request<E extends 'notes/reactions/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:reactions*
     */
    request<E extends 'notes/reactions/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'notes/renotes', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'notes/replies', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'notes/search', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'notes/search-by-tag', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'notes/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'notes/show-partial-bulk', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'notes/state', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'notes/thread-muting/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'notes/thread-muting/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'notes/timeline', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'notes/translate', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:notes*
     */
    request<E extends 'notes/unrenote', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'notes/user-list-timeline', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:notifications*
     */
    request<E extends 'notifications/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:notifications*
     */
    request<E extends 'notifications/flush', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:notifications*
     */
    request<E extends 'notifications/mark-all-as-read', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:notifications*
     */
    request<E extends 'notifications/test-notification', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'page-push', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:pages*
     */
    request<E extends 'pages/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:pages*
     */
    request<E extends 'pages/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'pages/featured', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:page-likes*
     */
    request<E extends 'pages/like', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'pages/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:page-likes*
     */
    request<E extends 'pages/unlike', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:pages*
     */
    request<E extends 'pages/update', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'ping', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'pinned-users', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'promo/read', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * リモート Misskey インスタンスのアカウントで視聴+コメント用のゲストログインを開始する。相手インスタンスの MiAuth へリダイレクトする URL を返す。
     * 
     * **Credential required**: *No*
     */
    request<E extends 'remote-guest/login/start', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * リモートゲストログインセッションをログアウトする。
     * 
     * **Credential required**: *No*
     */
    request<E extends 'remote-guest/session/revoke', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * リモートゲストログイン用のコメント履歴取得 (twitch/streams/comments の視聴専用版)。
     * 
     * **Credential required**: *No*
     */
    request<E extends 'remote-guest/twitch-comments', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * リモートゲストログイン用のコメント投稿 (twitch/streams/comments/create の視聴専用版)。添付ファイルは使えない。
     * 
     * **Credential required**: *No*
     */
    request<E extends 'remote-guest/twitch-comments/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:mutes*
     */
    request<E extends 'renote-mute/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:mutes*
     */
    request<E extends 'renote-mute/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:mutes*
     */
    request<E extends 'renote-mute/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Request a users password to be reset.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'request-reset-password', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Only available when running with <code>NODE_ENV=testing</code>. Reset the database and flush Redis.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'reset-db', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Complete the password reset that was previously requested.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'reset-password', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'retention', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'reversi/cancel-match', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'reversi/games', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'reversi/invitations', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'reversi/match', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'reversi/show-game', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'reversi/surrender', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'reversi/verify', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'roles/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'roles/notes', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'roles/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'roles/users', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'server-info', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'stats', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Register to receive push notifications.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'sw/register', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Check push notification registration exists.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'sw/show-registration', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Unregister from receiving push notifications.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'sw/unregister', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Update push notification registration.
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'sw/update-registration', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Endpoint for testing input validation.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'test', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Twitch アカウント連携の認可 URL を発行する。forBot はインスタンス共通中継 bot の連携用 (管理者専用)。
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'twitch/generate-oauth-url', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * 自分の Twitch 連携状態を返す。botLinked はインスタンス共通中継 bot が設定済みかどうか。
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'twitch/my-account', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * 配信者本人が自分の過去配信のアーカイブ (Google Drive / YouTube) 状況を確認するための一覧。カーソルページネーション (untilId) 対応。
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'twitch/streams/archive-history', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * 自分の配信チャットからコメントの投稿者をブロックする (配信者専用)。対象はコメント行から導出され、以後この配信者の配信にコメントできなくなる。Twitch 由来コメントの場合は Misskey 側への取り込みが止まる。
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'twitch/streams/blocks/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * 自分の配信チャットのブロックを解除する (配信者専用)。
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'twitch/streams/blocks/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * 自分の配信チャットのブロック一覧を取得する (配信者専用)。
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'twitch/streams/blocks/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * YouTubeアップロードのリトライキューをキャンセルする(配信者本人のみ)。Drive側に一時退避されたファイルは削除しない (視聴者が引き続き閲覧できるようにするため)。
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'twitch/streams/cancel-youtube-upload', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * 配信セッションのコメント履歴を返す (Misskey ユーザー投稿 + Twitch チャット由来)。OBS オーバーレイ等から匿名でも取得できる。
     * 
     * **Credential required**: *No*
     */
    request<E extends 'twitch/streams/comments', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * 配信にコメントを投稿する。ノートとは独立した専用コメントで、配信ページ上でのみ表示される。中継 bot が設定されていれば Twitch チャットにも送信される。
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'twitch/streams/comments/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * 配信者自身が配信開始前にチャット動作確認 (プレビュー) を行うための配信セッションを find-or-create する。返る stream は twitch/streams/show と同形で isPreview: true が付く。配信中判定 (isLive) には一切影響しない。
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'twitch/streams/preview', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * retention 期間中の録画 mp4 の Google Drive 再アップロードを開始する (配信者本人のみ、bsky-fork 独自、YouTube 12時間アーカイブ上限対策)。前提チェックの完了後すぐ応答し、アップロード本体はサーバー側でバックグラウンド継続する (大容量ファイルの転送完了を同期で待つとリバースプロキシのタイムアウトにかかるため)。進捗と結果は recordingStatus (uploading → processing/ready | failed) で追跡する。
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'twitch/streams/retry-drive-upload', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * 指定ユーザーの Twitch 配信状態を返す。連携済みなら twitchLogin は常に返り、配信中なら stream が非 null。視聴ページ (/live/:acct) が未ログイン・リモートゲストからも到達可能なため認証不要 (副作用のない読み取り専用エンドポイント)。
     * 
     * **Credential required**: *No*
     */
    request<E extends 'twitch/streams/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * 配信者本人が自分の配信アーカイブの公開を取り消す (冪等)。Google Drive / YouTube 上の実ファイルは削除しない。MSJP 側の一覧・視聴・コメントリプレイから見えなくなるのみで、再公開する endpoint は存在しない (一方向)。
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'twitch/streams/unpublish-archive', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * 配信者本人が自分の配信アーカイブの視聴制限 (視聴可否モード・パスワード・許可ユーザー) を個別に上書きする。配信終了時点の live_channel 設定のスナップショットを上書きするのみで、live_channel 側の設定自体には影響しない。
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'twitch/streams/update-archive-settings', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * password モードの視聴制限がある配信アーカイブのパスワードを検証し、成功時に視聴トークンを発行する。匿名視聴者もパスワードで視聴可能にするため認証不要。
     * 
     * **Credential required**: *No*
     */
    request<E extends 'twitch/streams/verify-archive-view-password', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * ライブ字幕イベント (caption/translation/clear) を自分の字幕チャンネルへ中継する。サーバーは中継のみ行い、DB への保存や翻訳処理は行わない。
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'twitch/subtitle/publish', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Twitch アカウント連携を解除する。
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes*
     */
    request<E extends 'twitch/unlink', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * 配信コメント翻訳機能など、Twitch 連携アカウントの配信者向け設定を更新する。
     * 
     * **Internal Endpoint**: This endpoint is an API for the misskey mainframe and is not intended for use by third parties.
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'twitch/update-settings', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'update-info/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'update-infos', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'username/available', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'users', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'users/achievements', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Show all clips this user owns.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'users/clips', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'users/featured-notes', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Show all flashs this user created.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'users/flashs', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Show everyone that follows this user.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'users/followers', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Show everyone that this user is following.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'users/following', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Show all gallery posts by the given user.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'users/gallery/posts', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Retrieve users who have a birthday on the specified range.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'users/get-following-users-by-birthday', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Get a list of other users that the specified user frequently replies to.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'users/get-frequently-replied-users', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Create a new list of users.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'users/lists/create', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'users/lists/create-from-public', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Delete an existing list of users.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'users/lists/delete', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'users/lists/favorite', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No* / **Permission**: *read:account*
     */
    request<E extends 'users/lists/get-memberships', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Show all lists that the authenticated user has created.
     * 
     * **Credential required**: *No* / **Permission**: *read:account*
     */
    request<E extends 'users/lists/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Remove a user from a list.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'users/lists/pull', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Add a user to an existing list.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'users/lists/push', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Show the properties of a list.
     * 
     * **Credential required**: *No* / **Permission**: *read:account*
     */
    request<E extends 'users/lists/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'users/lists/unfavorite', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Update the properties of a list.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'users/lists/update', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'users/lists/update-membership', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'users/notes', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Show all pages this user created.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'users/pages', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Show all reactions this user made.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'users/reactions', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Show users that the authenticated user might be interested to follow.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'users/recommendation', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Show the different kinds of relations between the authenticated user and the specified user(s).
     * 
     * **Credential required**: *Yes* / **Permission**: *read:account*
     */
    request<E extends 'users/relation', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * File a report.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:report-abuse*
     */
    request<E extends 'users/report-abuse', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Search for users.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'users/search', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Search for a user by username and/or host.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'users/search-by-username-and-host', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * Show the properties of a user.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'users/show', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *write:account*
     */
    request<E extends 'users/update-memo', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *Yes* / **Permission**: *read:admin:emoji*
     */
    request<E extends 'v2/admin/emoji/list', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;

    /**
     * No description provided.
     * 
     * **Credential required**: *No*
     */
    request<E extends 'verify-email', P extends Endpoints[E]['req']>(
      endpoint: E,
      params: P,
      credential?: string | null,
    ): Promise<SwitchCaseResponseType<E, P>>;
  }
}
