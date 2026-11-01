import type { Settings } from "@smart-speed/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input, Label } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { ErrorState, Spinner } from "../components/ui/states";
import { apiGet, apiPatch } from "../lib/api";

interface SettingsResponse {
  settings: Settings;
}

interface SettingsForm {
  defaultLimitKmh: string;
  scaleFactor: string;
  captureOffsetMs: string;
  retentionDays: string;
  alertSound: boolean;
}

const DEFAULT_FORM: SettingsForm = {
  defaultLimitKmh: "40",
  scaleFactor: "1",
  captureOffsetMs: "200",
  retentionDays: "90",
  alertSound: true,
};

export function SettingsPage() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiGet<SettingsResponse>("/settings"),
  });
  const [form, setForm] = useState(DEFAULT_FORM);
  useEffect(() => {
    if (query.data?.settings) {
      const { settings } = query.data;
      setForm({
        defaultLimitKmh: String(settings.defaultLimitKmh),
        scaleFactor: String(settings.scaleFactor),
        captureOffsetMs: String(settings.captureOffsetMs),
        retentionDays: String(settings.retentionDays),
        alertSound: settings.alertSound,
      });
    }
  }, [query.data]);
  const update = useMutation({
    mutationFn: (values: Omit<Settings, "updatedAt">) =>
      apiPatch<SettingsResponse>("/settings", values),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    update.mutate({
      defaultLimitKmh: Number(form.defaultLimitKmh),
      scaleFactor: Number(form.scaleFactor),
      captureOffsetMs: Number(form.captureOffsetMs),
      retentionDays: Number(form.retentionDays),
      alertSound: form.alertSound,
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" description="Persisted platform defaults and alert behavior." />
      {query.isPending ? (
        <div className="flex min-h-48 items-center justify-center">
          <Spinner className="h-5 w-5" />
        </div>
      ) : query.isError ? (
        <ErrorState message="Could not load settings." retry={() => void query.refetch()} />
      ) : (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Detection policy</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={save}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="settings-limit">Default speed limit (km/h)</Label>
                  <Input
                    id="settings-limit"
                    type="number"
                    min={5}
                    max={200}
                    step={1}
                    required
                    value={form.defaultLimitKmh}
                    onChange={(event) => setForm({ ...form, defaultLimitKmh: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="settings-scale">Default scale factor</Label>
                  <Input
                    id="settings-scale"
                    type="number"
                    min={0.01}
                    max={1000}
                    step="any"
                    required
                    value={form.scaleFactor}
                    onChange={(event) => setForm({ ...form, scaleFactor: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="settings-offset">Capture offset (ms)</Label>
                  <Input
                    id="settings-offset"
                    type="number"
                    min={-5000}
                    max={5000}
                    step={1}
                    required
                    value={form.captureOffsetMs}
                    onChange={(event) => setForm({ ...form, captureOffsetMs: event.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="settings-retention">Retention (days)</Label>
                  <Input
                    id="settings-retention"
                    type="number"
                    min={1}
                    max={3650}
                    step={1}
                    required
                    value={form.retentionDays}
                    onChange={(event) => setForm({ ...form, retentionDays: event.target.value })}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-4">
                <Label htmlFor="settings-alert-sound" className="mb-0">
                  Browser overspeed alert sound
                </Label>
                <Switch
                  id="settings-alert-sound"
                  checked={form.alertSound}
                  onCheckedChange={(checked) => setForm({ ...form, alertSound: checked })}
                />
              </div>
              {update.isError && (
                <p role="alert" className="text-xs text-danger">
                  {update.error.message}
                </p>
              )}
              {update.isSuccess && <p className="text-xs text-ok">Settings saved.</p>}
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                Save settings
              </Button>
              <p className="text-[11px] text-muted-foreground">
                The registered gate has its own speed limit and scale factor. These values apply as
                defaults for future gates and system behavior.
              </p>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
