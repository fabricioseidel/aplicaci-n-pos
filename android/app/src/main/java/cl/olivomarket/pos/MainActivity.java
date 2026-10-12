package cl.olivomarket.pos;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Los plugins propios del APK se registran antes de levantar el bridge.
        registerPlugin(ImpresoraBTPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
