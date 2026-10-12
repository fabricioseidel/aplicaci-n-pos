package cl.olivomarket.pos;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.os.Build;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.IOException;
import java.io.OutputStream;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Impresión directa en una térmica Bluetooth (la MPT-II del mostrador).
 *
 * Bluetooth clásico con perfil serie (SPP): la impresora tiene que estar
 * vinculada desde los ajustes de Android. No se escanea, así que no hace falta
 * permiso de ubicación; en Android 12+ alcanza con BLUETOOTH_CONNECT.
 *
 * Recibe los bytes ESC/POS ya armados (en base64) desde la web: el formato del
 * ticket vive en src/lib/print y cambia con cada deploy, sin APK nuevo.
 */
@SuppressLint("MissingPermission")
@CapacitorPlugin(
    name = "ImpresoraBT",
    permissions = { @Permission(alias = ImpresoraBTPlugin.BLUETOOTH, strings = { Manifest.permission.BLUETOOTH_CONNECT }) }
)
public class ImpresoraBTPlugin extends Plugin {

    static final String BLUETOOTH = "bluetooth";

    /** UUID estándar del perfil serie: es el que escuchan las térmicas chinas. */
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    /** Las térmicas baratas tienen un buffer chico: se manda de a poco. */
    private static final int BLOQUE = 512;

    /** Una sola impresión a la vez: dos toques seguidos no abren dos conexiones. */
    private final ExecutorService cola = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void listar(PluginCall call) {
        if (faltaPermiso()) {
            requestPermissionForAlias(BLUETOOTH, call, "listarTrasPermiso");
            return;
        }
        hacerListar(call);
    }

    @PermissionCallback
    private void listarTrasPermiso(PluginCall call) {
        if (faltaPermiso()) {
            rechazarSinPermiso(call);
            return;
        }
        hacerListar(call);
    }

    @PluginMethod
    public void imprimir(PluginCall call) {
        if (faltaPermiso()) {
            requestPermissionForAlias(BLUETOOTH, call, "imprimirTrasPermiso");
            return;
        }
        hacerImprimir(call);
    }

    @PermissionCallback
    private void imprimirTrasPermiso(PluginCall call) {
        if (faltaPermiso()) {
            rechazarSinPermiso(call);
            return;
        }
        hacerImprimir(call);
    }

    private void hacerListar(PluginCall call) {
        BluetoothAdapter adapter = adaptador(call);
        if (adapter == null) return;
        try {
            JSArray dispositivos = new JSArray();
            for (BluetoothDevice d : adapter.getBondedDevices()) {
                JSObject o = new JSObject();
                o.put("nombre", d.getName());
                o.put("direccion", d.getAddress());
                dispositivos.put(o);
            }
            JSObject ret = new JSObject();
            ret.put("dispositivos", dispositivos);
            call.resolve(ret);
        } catch (SecurityException e) {
            rechazarSinPermiso(call);
        }
    }

    private void hacerImprimir(PluginCall call) {
        String direccion = call.getString("direccion");
        String datos = call.getString("datos");
        if (direccion == null || datos == null) {
            call.reject("Faltan la impresora o el contenido", "argumentos");
            return;
        }
        BluetoothAdapter adapter = adaptador(call);
        if (adapter == null) return;

        final byte[] bytes;
        final BluetoothDevice impresora;
        try {
            bytes = Base64.decode(datos, Base64.DEFAULT);
            impresora = adapter.getRemoteDevice(direccion);
        } catch (IllegalArgumentException e) {
            call.reject("Datos de impresión inválidos", "argumentos", e);
            return;
        }

        cola.execute(() -> {
            try {
                if (impresora.getBondState() != BluetoothDevice.BOND_BONDED) {
                    call.reject("La impresora ya no está vinculada", "no-vinculada");
                    return;
                }
                BluetoothSocket socket = conectar(impresora);
                try {
                    OutputStream out = socket.getOutputStream();
                    for (int i = 0; i < bytes.length; i += BLOQUE) {
                        out.write(bytes, i, Math.min(BLOQUE, bytes.length - i));
                        out.flush();
                        Thread.sleep(30);
                    }
                    // Cerrar apenas se termina de escribir puede cortar el final
                    // del ticket: la impresora sigue recibiendo lo del buffer.
                    Thread.sleep(800);
                } finally {
                    cerrar(socket);
                }
                call.resolve();
            } catch (SecurityException e) {
                rechazarSinPermiso(call);
            } catch (IOException e) {
                call.reject("No se pudo conectar con la impresora", "conexion", e);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                call.reject("Se interrumpió la impresión", "conexion", e);
            }
        });
    }

    /**
     * Conexión segura primero; si la impresora no la acepta (pasa con varios
     * modelos genéricos), se reintenta sin cifrado.
     */
    private BluetoothSocket conectar(BluetoothDevice impresora) throws IOException {
        BluetoothSocket socket = impresora.createRfcommSocketToServiceRecord(SPP);
        try {
            socket.connect();
            return socket;
        } catch (IOException primero) {
            cerrar(socket);
            BluetoothSocket inseguro = impresora.createInsecureRfcommSocketToServiceRecord(SPP);
            try {
                inseguro.connect();
                return inseguro;
            } catch (IOException segundo) {
                cerrar(inseguro);
                throw segundo;
            }
        }
    }

    private BluetoothAdapter adaptador(PluginCall call) {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter adapter = manager != null ? manager.getAdapter() : null;
        if (adapter == null) {
            call.reject("Este equipo no tiene Bluetooth", "sin-bluetooth");
            return null;
        }
        if (!adapter.isEnabled()) {
            call.reject("El Bluetooth está apagado", "apagado");
            return null;
        }
        return adapter;
    }

    /** Antes de Android 12 el permiso de Bluetooth se otorga al instalar. */
    private boolean faltaPermiso() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState(BLUETOOTH) != PermissionState.GRANTED;
    }

    private void rechazarSinPermiso(PluginCall call) {
        call.reject("Falta el permiso de Bluetooth", "permiso");
    }

    private static void cerrar(BluetoothSocket socket) {
        try {
            socket.close();
        } catch (IOException ignorada) {
            // Ya estaba cerrada: no hay nada que hacer.
        }
    }

    @Override
    protected void handleOnDestroy() {
        cola.shutdown();
    }
}
