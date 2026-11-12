import type { MenuItem } from '../schemas';
import { useMerchantT } from '../texts';

/** What the kitchen can leave out of each dish and add to it, from the menu, as the agent sees it. */
export function AgentKitchen({ menu }: { menu: readonly MenuItem[] }) {
  const t = useMerchantT().agent;
  return (
    <section className="mc-panel" aria-labelledby="mc-kitchen-title">
      <h2 id="mc-kitchen-title" className="mc-panel-title">
        {t.kitchen}
      </h2>
      <p className="mc-note">{t.kitchenLead}</p>
      <ul className="mc-kitchen">
        {menu.map((item) => {
          const removable = item.ingredients.filter((i) => i.removable).map((i) => i.name);
          const extras = item.extras.map((extra) => extra.name);
          return (
            <li key={item.id}>
              <p className="mc-kitchen-dish">{item.name}</p>
              {removable.length === 0 && extras.length === 0 ? (
                <p className="mc-note">{t.noChanges}</p>
              ) : (
                <dl>
                  {removable.length > 0 && (
                    <div>
                      <dt>{t.leaveOut}</dt>
                      <dd lang="en">{removable.join(', ')}</dd>
                    </div>
                  )}
                  {extras.length > 0 && (
                    <div>
                      <dt>{t.add}</dt>
                      <dd lang="en">{extras.join(', ')}</dd>
                    </div>
                  )}
                </dl>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
