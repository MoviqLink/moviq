import type { ColDef } from 'ag-grid-community';
import { useMemo } from 'react';

import { useLocale } from '../../../shared/i18n';
import { formatCityDay, formatCityTime } from '../../../shared/time/city';
import { DataGrid, NUMERIC } from '../../../shared/ui/DataGrid';
import { merchantApi } from '../api';
import { preferenceTags } from '../model/conversation';
import { latestNeeds } from '../model/customers';
import { useMerchantT, type MerchantDict } from '../texts';
import { useResource } from '../useResource';
import { Head } from '../ui/Head';
import { Loaded } from '../ui/Loaded';

/** A customer as the merchant may see one: an alias and what matters for the menu, no more. */
interface CustomerRow {
  readonly alias: string;
  readonly tags: string;
  readonly offers: number;
  readonly orders: number;
  readonly lastSeenAt: string;
}

function columns(t: MerchantDict, locale: string): ColDef<CustomerRow>[] {
  return [
    { headerName: t.customers.alias, field: 'alias', width: 150 },
    { headerName: t.customers.tags, field: 'tags', flex: 1, minWidth: 240 },
    { headerName: t.customers.offers, field: 'offers', width: 110, ...NUMERIC },
    { headerName: t.customers.orders, field: 'orders', width: 110, ...NUMERIC },
    {
      headerName: t.customers.lastSeen,
      field: 'lastSeenAt',
      sort: 'desc',
      width: 220,
      cellClass: 'mono',
      valueFormatter: ({ value }) =>
        typeof value === 'string'
          ? `${formatCityDay(value, locale)} · ${formatCityTime(value, locale)}`
          : '',
    },
  ];
}

/** "Customers": by alias, with the preferences of the latest need Sara sent for each. */
export function CustomersView() {
  const t = useMerchantT();
  const locale = useLocale();
  const customers = useResource(merchantApi.customers);
  const requests = useResource(merchantApi.requests);
  const needs = useMemo(() => latestNeeds(requests.data ?? []), [requests.data]);
  const grid = useMemo(() => columns(t, locale), [t, locale]);
  return (
    <>
      <Head title={t.customers.title} lead={t.customers.lead} receivedAt={customers.receivedAt} />
      <Loaded resource={customers}>
        {(data) => (
          <DataGrid<CustomerRow>
            rows={data.map((customer) => {
              const need = needs.get(customer.alias);
              const tags =
                need === undefined ? [] : preferenceTags(need.preferences, t.conversation);
              return {
                alias: customer.alias,
                tags: tags.length === 0 ? t.customers.nothing : tags.join(' · '),
                offers: customer.offers,
                orders: customer.orders,
                lastSeenAt: customer.lastSeenAt,
              };
            })}
            columns={grid}
            label={t.customers.label}
            empty={t.customers.empty}
            getRowId={({ data: row }) => row.alias}
          />
        )}
      </Loaded>
    </>
  );
}
