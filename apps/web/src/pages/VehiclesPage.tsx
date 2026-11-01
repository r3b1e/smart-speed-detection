import type { Vehicle } from "@smart-speed/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Car, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input, Label } from "../components/ui/input";
import { EmptyState, ErrorState, Spinner } from "../components/ui/states";
import { apiDelete, apiGet, apiPatch, apiPost } from "../lib/api";
import { formatDateTime } from "../lib/format";

interface VehicleListResponse {
  items: Vehicle[];
}

interface VehicleResponse {
  vehicle: Vehicle;
}

export function VehiclesPage() {
  const queryClient = useQueryClient();
  const [plate, setPlate] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => apiGet<VehicleListResponse>("/vehicles"),
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["vehicles"] });
  const create = useMutation({
    mutationFn: () =>
      apiPost<VehicleResponse>("/vehicles", { plate, nickname: nickname || undefined }),
    onSuccess: async () => {
      setPlate("");
      setNickname("");
      setError(null);
      await invalidate();
    },
    onError: (cause) => setError(cause.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/vehicles/${id}`),
    onSuccess: invalidate,
    onError: (cause) => setError(cause.message),
  });
  const rename = useMutation({
    mutationFn: ({ id, nickname: value }: { id: string; nickname: string }) =>
      apiPatch<VehicleResponse>(`/vehicles/${id}`, { nickname: value }),
    onSuccess: invalidate,
    onError: (cause) => setError(cause.message),
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    create.mutate();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="My Vehicles"
        description="Register plates to match your gate detections."
      />
      <Card>
        <CardHeader>
          <CardTitle>Register vehicle</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={submit}>
            <div>
              <Label htmlFor="vehicle-plate">Plate number</Label>
              <Input
                id="vehicle-plate"
                required
                minLength={2}
                maxLength={32}
                value={plate}
                onChange={(event) => setPlate(event.target.value.toUpperCase())}
              />
            </div>
            <div>
              <Label htmlFor="vehicle-nickname">Nickname (optional)</Label>
              <Input
                id="vehicle-nickname"
                maxLength={60}
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
              />
            </div>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? <Spinner /> : <Car className="h-4 w-4" />}Add vehicle
            </Button>
          </form>
          {error && (
            <p role="alert" className="mt-3 text-xs text-danger">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
      {query.isPending ? (
        <div className="flex min-h-48 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : query.isError ? (
        <ErrorState message="Could not load vehicles." retry={() => void query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <EmptyState
          title="No vehicles registered"
          description="Add a plate to see matching detections here."
        />
      ) : (
        <div className="divide-y divide-border border-y border-border">
          {query.data.items.map((vehicle) => (
            <VehicleRow
              key={vehicle.id}
              vehicle={vehicle}
              onDelete={() => remove.mutate(vehicle.id)}
              onRename={(value) => rename.mutate({ id: vehicle.id, nickname: value })}
              busy={remove.isPending || rename.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function VehicleRow({
  vehicle,
  onDelete,
  onRename,
  busy,
}: {
  vehicle: Vehicle;
  onDelete: () => void;
  onRename: (nickname: string) => void;
  busy: boolean;
}) {
  const [nickname, setNickname] = useState(vehicle.nickname ?? "");
  return (
    <div className="grid gap-3 py-4 md:grid-cols-[minmax(10rem,1fr)_minmax(12rem,1fr)_10rem_auto] md:items-end">
      <div>
        <p className="num text-sm font-semibold">{vehicle.plate}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Registered {formatDateTime(vehicle.createdAt)}
        </p>
      </div>
      <div>
        <Label htmlFor={`vehicle-name-${vehicle.id}`}>Nickname</Label>
        <Input
          id={`vehicle-name-${vehicle.id}`}
          maxLength={60}
          value={nickname}
          onChange={(event) => setNickname(event.target.value)}
        />
      </div>
      <p className="text-xs text-muted-foreground">{vehicle.matchCount ?? 0} matched detections</p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => onRename(nickname)}>
          Save
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove ${vehicle.plate}`}
          disabled={busy}
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
