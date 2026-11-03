import { Link } from "@tanstack/react-router";
import { Search, SearchX } from "lucide-react";
import type { ReactNode } from "react";

import type { ExperimentOverview } from "../../domain/experiments/contracts";
import { m } from "../../paraglide/messages";
import { Absent } from "../../ui/Absent";
import { Day } from "../../ui/Day";
import { usePagedSearch } from "../../ui/hooks/usePagedSearch";
import { Empty } from "../../ui/kit/Empty";
import { Icon } from "../../ui/kit/Icon";
import { Input } from "../../ui/kit/Input";
import { Pagination } from "../../ui/kit/Pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/kit/Table";
import { TextLink } from "../../ui/kit/TextLink";
import { formatCount } from "../../ui/numbers";
import { joinFacts } from "./labels";

/** What an experiment is found by: its name and what it grows on what. */
function searchable({ experiment }: ExperimentOverview): string {
  return [
    experiment.name,
    experiment.plantMaterial,
    experiment.explantType,
    experiment.baseMedium,
  ]
    .join("\n")
    .toLowerCase();
}

/**
 * Every experiment, one row each: what it grows, when it was inoculated, the
 * size of its design and how far its observations have come. `empty` stands
 * in for no experiments at all.
 */
export function ExperimentsTable({
  experiments,
  empty,
}: {
  experiments: ExperimentOverview[];
  empty: ReactNode;
}) {
  const { query, setQuery, matches, shown, pagination } = usePagedSearch(
    experiments,
    { text: searchable },
  );

  return (
    <Table
      aria-label={m.experiments_title()}
      narrow="cards"
      toolbar={
        experiments.length > 0 ? (
          <Input
            aria-label={m.experiments_search()}
            className="w-48"
            placeholder={m.experiments_search()}
            prefix={<Icon icon={Search} size={14} />}
            size="small"
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        ) : undefined
      }
      footer={pagination ? <Pagination {...pagination} /> : undefined}
      empty={
        experiments.length === 0 ? (
          empty
        ) : matches.length === 0 ? (
          <Empty
            icon={SearchX}
            title={m.experiments_no_matches()}
            description={m.experiments_no_matches_description()}
          />
        ) : undefined
      }
    >
      <TableHeader>
        <tr>
          <TableHead>{m.experiments_column_experiment()}</TableHead>
          <TableHead>{m.experiments_column_material()}</TableHead>
          <TableHead>{m.experiments_column_medium()}</TableHead>
          <TableHead>{m.experiments_column_inoculated()}</TableHead>
          <TableHead className="w-20" numeric>
            {m.experiments_column_treatments()}
          </TableHead>
          <TableHead className="w-24" numeric>
            {m.experiments_column_units()}
          </TableHead>
          <TableHead className="w-24" numeric>
            {m.experiments_column_observations()}
          </TableHead>
          <TableHead>{m.experiments_column_last_observed()}</TableHead>
        </tr>
      </TableHeader>
      <TableBody>
        {shown.map(
          ({ experiment, treatments, units, observations, lastObservedOn }) => {
            const material = joinFacts(
              [experiment.plantMaterial, experiment.explantType].filter(
                Boolean,
              ),
            );
            return (
              <TableRow key={experiment.id} clickable>
                <TableCell cellSlot="title">
                  <TextLink
                    className="block max-w-80 truncate"
                    render={
                      <Link
                        to="/experiments/$experiment"
                        params={{ experiment: experiment.id }}
                      />
                    }
                  >
                    {experiment.name}
                  </TextLink>
                </TableCell>
                <TableCell cellLabel={m.experiments_column_material()}>
                  {material || <Absent />}
                </TableCell>
                <TableCell cellLabel={m.experiments_column_medium()}>
                  {experiment.baseMedium || <Absent />}
                </TableCell>
                <TableCell
                  cellLabel={m.experiments_column_inoculated()}
                  className="whitespace-nowrap"
                >
                  <Day value={experiment.inoculatedOn} />
                </TableCell>
                <TableCell
                  cellLabel={m.experiments_column_treatments()}
                  numeric
                >
                  {formatCount(treatments)}
                </TableCell>
                <TableCell cellLabel={m.experiments_column_units()} numeric>
                  {formatCount(units)}
                </TableCell>
                <TableCell
                  cellLabel={m.experiments_column_observations()}
                  numeric
                >
                  {formatCount(observations)}
                </TableCell>
                <TableCell
                  cellLabel={m.experiments_column_last_observed()}
                  className="whitespace-nowrap"
                >
                  {lastObservedOn ? <Day value={lastObservedOn} /> : <Absent />}
                </TableCell>
              </TableRow>
            );
          },
        )}
      </TableBody>
    </Table>
  );
}
