import { useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FabricObject, Canvas as FabricCanvas } from "fabric";
import { Json } from "@/integrations/supabase/types";
import { toast } from "sonner";

interface UseRealtimeWhiteboardOptions {
  whiteboardId: string | null;
  canvas: FabricCanvas | null;
  enabled: boolean;
}

export function useRealtimeWhiteboard({ 
  whiteboardId, 
  canvas, 
  enabled 
}: UseRealtimeWhiteboardOptions) {
  const isLocalChangeRef = useRef(false);
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const canvasRef = useRef(canvas);

  // Keep canvas ref updated
  useEffect(() => {
    canvasRef.current = canvas;
  }, [canvas]);

  // Load objects from database
  const loadObjectsFromDB = useCallback(async () => {
    const currentCanvas = canvasRef.current;
    if (!whiteboardId || !currentCanvas) return;

    try {
      const { data, error } = await supabase
        .from('whiteboard_objects')
        .select('*')
        .eq('whiteboard_id', whiteboardId)
        .order('z_index', { ascending: true });

      if (error) throw error;

      console.log('[Realtime] Loading', data?.length || 0, 'objects from DB');

      // Clear and reload canvas
      currentCanvas.clear();
      currentCanvas.backgroundColor = "#1e293b";

      if (data && data.length > 0) {
        const jsonObjects = data.map(obj => obj.properties);
        
        // Use loadFromJSON to restore objects
        await currentCanvas.loadFromJSON({ 
          objects: jsonObjects,
          background: "#1e293b"
        }, () => {
          currentCanvas.renderAll();
        });
      } else {
        currentCanvas.renderAll();
      }
    } catch (error) {
      console.error('[Realtime] Error loading objects:', error);
    }
  }, [whiteboardId]);

  // Subscribe to realtime changes
  useEffect(() => {
    if (!whiteboardId || !enabled || !canvas) return;

    console.log('[Realtime] Subscribing to whiteboard:', whiteboardId);

    const channel = supabase
      .channel(`whiteboard-${whiteboardId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'whiteboard_objects',
          filter: `whiteboard_id=eq.${whiteboardId}`,
        },
        (payload) => {
          console.log('[Realtime] Received change:', payload.eventType);
          
          // Skip if this was a local change
          if (isLocalChangeRef.current) {
            console.log('[Realtime] Skipping local change');
            return;
          }

          // Debounce to batch rapid changes
          if (syncTimeoutRef.current) {
            clearTimeout(syncTimeoutRef.current);
          }

          syncTimeoutRef.current = setTimeout(() => {
            loadObjectsFromDB();
          }, 300);
        }
      )
      .subscribe((status) => {
        console.log('[Realtime] Subscription status:', status);
        if (status === 'SUBSCRIBED') {
          toast.success('Colaboração em tempo real ativada');
        }
      });

    return () => {
      console.log('[Realtime] Unsubscribing from whiteboard');
      supabase.removeChannel(channel);
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [whiteboardId, enabled, loadObjectsFromDB]);

  // Save objects to database with local flag
  const saveObjectsRealtime = useCallback(async (objects: FabricObject[]) => {
    if (!whiteboardId) return;

    isLocalChangeRef.current = true;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Delete existing objects
      await supabase
        .from('whiteboard_objects')
        .delete()
        .eq('whiteboard_id', whiteboardId);

      if (objects.length === 0) {
        return;
      }

      // Insert new objects
      const objectsToInsert = objects.map((obj, index) => ({
        whiteboard_id: whiteboardId,
        type: obj.type || 'unknown',
        properties: obj.toObject() as unknown as Json,
        z_index: index,
        created_by: user.id,
      }));

      const { error } = await supabase
        .from('whiteboard_objects')
        .insert(objectsToInsert);

      if (error) throw error;
    } catch (error) {
      console.error('[Realtime] Error saving objects:', error);
    } finally {
      // Reset flag after a short delay to allow the change to propagate
      setTimeout(() => {
        isLocalChangeRef.current = false;
      }, 500);
    }
  }, [whiteboardId]);

  return {
    saveObjectsRealtime,
    loadObjectsFromDB,
  };
}
